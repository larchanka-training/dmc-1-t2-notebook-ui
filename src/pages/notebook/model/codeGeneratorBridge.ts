import { wrap } from '@reatom/core'
import {
  codeGeneratorAtom,
  loadedModelDisplayAtom,
  interruptInBrowserAtom,
  thinkingSessionAtom,
} from '@/features/notebook'
import {
  type InBrowserGenerator,
  type InBrowserGenerateResult,
  type InBrowserIncompleteReason,
  IN_BROWSER_MAX_TOKENS,
  IN_BROWSER_THINK_TOKEN_BUDGET,
  IN_BROWSER_TEMPERATURE,
  IN_BROWSER_REPETITION_PENALTY,
  IN_BROWSER_FREQUENCY_PENALTY,
} from '@/features/notebook'
import { engineAtom, loadedModelIdAtom, isReasoningModel } from '@/features/web-llm'
import { splitThinkAndCode } from './reasoningParser'
import { isParseableJs, detectSandboxViolations } from './codeValidation'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// After we ask the engine to stop (budget cap or user Stop), the stream should
// emit its final chunk and end almost immediately. If it doesn't within this
// window the generation is wedged — we stop waiting rather than hang the UI on
// "Thinking…" forever (TARDIS-168 H6).
const POST_INTERRUPT_DRAIN_MS = 5000

const DRAIN_TIMED_OUT = Symbol('drain-timed-out')

// Resolve with the promise, or with DRAIN_TIMED_OUT if `ms` elapses first. The
// timer is cleared when the promise wins so a healthy stream leaves no pending
// timeout behind.
function withDrainTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof DRAIN_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<typeof DRAIN_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(DRAIN_TIMED_OUT), ms)
  })
  return Promise.race([p.then((v) => v).finally(() => clearTimeout(timer)), timeout])
}

// One streamed generation pass: drains the WebLLM stream, surfaces reasoning +
// token progress, and enforces the think-token budget. Returns the raw model
// text and the think/code split. Extracted so the auto-repair retry can run a
// second pass without duplicating the streaming/lock-safe loop (TARDIS-168).
async function streamOnce(
  engine: NonNullable<ReturnType<typeof engineAtom>>,
  messages: ChatMessage[],
  onProgress: ((p: { thinking: string; tokens: number }) => void) | undefined,
  tokenOffset: number,
  isReasoning: boolean,
): Promise<{ raw: string; tokens: number }> {
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    max_tokens: IN_BROWSER_MAX_TOKENS,
    // Sampling defaults (TARDIS-168 C2): low temperature for deterministic
    // codegen + repetition/frequency penalties that break the self-confirming
    // reasoning loop a prompt alone can't stop.
    temperature: IN_BROWSER_TEMPERATURE,
    frequency_penalty: IN_BROWSER_FREQUENCY_PENALTY,
    repetition_penalty: IN_BROWSER_REPETITION_PENALTY,
  })

  let raw = ''
  let lastThinking = ''
  // WebLLM streams one decode-step per chunk, so the chunk count IS the number
  // of generated tokens — an exact live counter without a separate tokenizer.
  // `tokenOffset` carries the first pass's count so a retry keeps counting up.
  let tokens = 0
  let budgetHit = false
  // Manual iteration (not `for await`) so we can put a bounded timeout on each
  // `next()` ONCE we've asked the engine to stop — see the watchdog below.
  const iterator = stream[Symbol.asyncIterator]()
  for (;;) {
    // CRITICAL (lock safety): while the engine is running normally we DO NOT
    // `break`/`return` early. WebLLM holds a per-model lock for the whole
    // generation and releases it only when its async generator runs to
    // completion; abandoning the iterator early calls its `.return()` before
    // that release, leaking the lock so the NEXT `create()` blocks forever
    // (a dead loader, a frozen Stop). So on a budget/stop we raise the
    // interrupt flag and keep draining — the engine sees it, ends, and emits
    // its final chunk, releasing the lock cleanly.
    //
    // H6 watchdog: a wedged engine might never end the stream even after the
    // interrupt. Once we've interrupted, bound each `next()` by a timeout; if it
    // trips, the generation is unrecoverable, so we destroy the engine
    // (`unload()` frees the WebGPU device AND makes the leaked lock moot — the
    // whole engine is gone) and drop `engineAtom` so the UI asks for a reload
    // instead of hanging on "Thinking…" forever.
    const nextPromise = iterator.next()
    const next = budgetHit
      ? await withDrainTimeout(nextPromise, POST_INTERRUPT_DRAIN_MS)
      : await nextPromise
    if (next === DRAIN_TIMED_OUT) {
      await wrap(Promise.resolve(engine.unload()).catch(() => undefined))
      await wrap(async () => {
        engineAtom.set(null)
        loadedModelIdAtom.set(null)
      })()
      break
    }
    if (next.done) break

    const delta = next.value.choices[0]?.delta.content ?? ''
    if (delta) tokens += 1
    raw += delta
    const partial = splitThinkAndCode(raw)
    if (partial.thinking !== lastThinking || delta) {
      lastThinking = partial.thinking
      onProgress?.({ thinking: partial.thinking, tokens: tokenOffset + tokens })
    }
    // Kill a runaway reasoning loop: still thinking, no code, over budget. Raise
    // the interrupt once (never per chunk) and let the loop keep draining. Only
    // reasoning models open a <think> block, so the budget gate is a no-op for
    // others; we additionally gate on `isReasoning` to make that explicit and
    // avoid clipping a non-reasoning model that legitimately emits a literal
    // "<think>" string in its output (TARDIS-168 C1).
    if (isReasoning && !budgetHit && partial.thinkOpen && tokens > IN_BROWSER_THINK_TOKEN_BUDGET) {
      budgetHit = true
      void engine.interruptGenerate()
    }
  }
  return { raw, tokens }
}

// Build the one-shot correction prompt when the cell code reached for DOM/canvas
// /network APIs that don't exist in the QuickJS cell scope. Names the exact
// offending APIs and the one correct pattern (draw inside the display() iframe).
function buildRepairInstruction(violations: string[], previousCode: string): string {
  return [
    `Your previous answer used these APIs that DO NOT exist in the notebook cell: ${violations.join(', ')}.`,
    'The cell runs in QuickJS with NO document/window/canvas and no network.',
    'It has NO ES module syntax either — never use import/export/import()/import.meta.',
    'Rewrite it so it runs as-is. If it draws graphics, return ONLY a single',
    "display({ type: 'html', value: '<svg>…</svg>' }) (or a <canvas> + <script> inside the html string) —",
    'all DOM/canvas calls must live INSIDE that html string, never in the cell.',
    'If it cannot be done without those APIs, use console.log to say so.',
    'Return ONLY JavaScript code, no fences.',
    `Previous answer:\n${previousCode}`,
  ].join('\n')
}

// System prompt for the In-browser agent (T1). It must describe the REAL
// runtime so the model stops emitting unrunnable code (TARDIS-168): cells run in
// a QuickJS (WebAssembly) engine inside a Web Worker — plain ECMAScript, with no
// DOM, no network, no timers, no Node/Python APIs and no module syntax. Rich
// output goes ONLY through the injected global `display()` (see
// `features/notebook/runtime/quickjs.ts` — the source of truth for the sandbox
// surface and the allowed image MIME types).
//
// Ordering is deliberate: capabilities first, then the HARD CONSTRAINTS and the
// graceful-degradation rule LAST. Small quantised local models weight the
// trailing tokens most, and a user can explicitly ask for a forbidden API
// (e.g. "fetch swapi.info"); putting the bans + the fallback at the very end is
// the strongest a prompt can do to stop a plausible-but-unrunnable answer.
export const IN_BROWSER_SYSTEM_PROMPT = `You are a JavaScript code generator for a notebook.
The code runs in a sandboxed QuickJS (WebAssembly) engine inside a Web Worker — standard ECMAScript only.
Use console.log for text output; the cell's trailing expression is shown as its result; top-level await is supported.
By default, produce plain JavaScript using console.log or a trailing expression.
Call display() ONLY when the task explicitly asks for visual/graphical/HTML/image output.
For rich output, call the injected global display(): display({ type: 'html', value: '<div>…</div>' }) renders HTML/SVG/<canvas>/<script> in a sandboxed iframe; display({ type: 'image', mime, data }) renders a base64 image (mime one of image/png, image/jpeg, image/gif, image/webp, image/svg+xml).
display() accepts ONLY type 'html' or type 'image' — there is no type 'canvas'. The html string ALWAYS goes in the 'value' field (never an 'html' field). For a canvas, use type 'html' and put the <canvas> inside 'value'.
If the task needs to draw graphics, put the <canvas> AND the drawing <script> INSIDE the display() html string (that iframe has a real document/window where getContext/toDataURL work); the cell itself has no document, so never call document/getContext in the cell.
Return ONLY the JavaScript code — no markdown code fences, no explanation, no comments unless asked.
HARD CONSTRAINTS (these always win, even if the user asks otherwise):
There is NO DOM (no document/window), NO network (no fetch/XMLHttpRequest), NO timers (no setTimeout/setInterval), NO Node.js or Python APIs, and NO module syntax (no import/require/export). For graphics, draw inside the display() html string (above), never with document/canvas in the cell.
If the task needs a capability this sandbox does not have (network/fetch, files, timers, modules), DO NOT call or fake those APIs — they throw a ReferenceError at runtime. Instead return runnable code that uses console.log to state the capability is unavailable in the notebook sandbox.
Charts, graphics, canvas and visualizations ARE supported — render them with display() html (the iframe has a real document/window). NEVER refuse a drawing task by claiming the sandbox lacks DOM/canvas; the display() iframe provides them.
Building DOM elements (a div, a list, a table, appending to the page) IS supported the same way: put that HTML in display({ type: 'html', value: '…' }) — do NOT refuse it as "DOM unavailable". Only truly missing capabilities (network/fetch, files, timers, modules) warrant the console.log fallback below.
[CRITICAL CONSTRAINT]:
Keep any reasoning to at most 3 short paragraphs. Your main job is to output the final answer — as soon as you understand the basic logic, stop reasoning and emit the code.
Your final answer must be pure JavaScript only — no markdown, no prose, no explanation.
For a non-visual result, output it with console.log or a trailing expression; for a visual/graphical result, output it with display() as described above.`

// Centralise the incomplete-result path (TARDIS-168 M2): log WHY the generation
// failed (degenerate loop / empty / unparseable / sandbox violations) so a
// developer debugging "the model won't generate" has a precise category, then
// return the typed result the UI turns into a specific recovery hint. We log the
// reason + offending API names only — never the prompt or the generated code —
// so no user content leaks into the console.
function reportIncomplete(args: {
  code: string
  thinking: string
  reason: InBrowserIncompleteReason
  violations?: string[]
}): InBrowserGenerateResult {
  const { code, thinking, reason, violations } = args
  const detail = violations && violations.length > 0 ? ` [${violations.join(', ')}]` : ''
  console.warn(`in-browser generation incomplete: ${reason}${detail}`)
  return { code, thinking, incomplete: true, reason }
}

export function buildGenerator(
  engine: NonNullable<ReturnType<typeof engineAtom>>,
): InBrowserGenerator {
  // Resolve once per build: the think-token budget applies only to reasoning
  // models (TARDIS-168 C1). The engine atom is rebound on every model load, so
  // the id read here matches the engine this generator was built for.
  const isReasoning = isReasoningModel(loadedModelIdAtom())
  return async (prompt, onProgress) => {
    // Pass 1.
    // `wrap` the stream so the Reatom frame is RESTORED after the await: streamOnce
    // does external (WebLLM) I/O with internal unwrapped awaits, so without this
    // the continuation runs outside the frame and a later atom read
    // (thinkingSessionAtom() below) throws "missing async stack" (TARDIS-168).
    const first = await wrap(
      streamOnce(
        engine,
        [
          { role: 'system', content: IN_BROWSER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        onProgress,
        0,
        isReasoning,
      ),
    )
    const { thinking, code, thinkOpen } = splitThinkAndCode(first.raw)

    // Deterministic repair (TARDIS-168): a prompt can't stop a small model from
    // emitting DOM/canvas/network code in the cell, so when the code parses but
    // references sandbox-forbidden APIs, run ONE corrective pass naming the exact
    // offenders. Only retry parseable-but-violating code: an unparseable or empty
    // answer is handled below, and a clean answer needs no second round.
    if (!thinkOpen && code.length > 0 && isParseableJs(code)) {
      const violations = detectSandboxViolations(code)
      // M1 (TARDIS-168): if the user already hit Stop during pass 1, do NOT spend
      // a second full stream on auto-repair. The user asked to abort, so surface
      // the (still-violating) pass-1 result as incomplete instead of running on.
      if (violations.length > 0 && thinkingSessionAtom()?.stopRequested) {
        return reportIncomplete({ code, thinking, reason: 'violations', violations })
      }
      if (violations.length > 0) {
        // Same wrap rationale as pass 1: keep the frame for the post-await checks.
        const second = await wrap(
          streamOnce(
            engine,
            [
              { role: 'system', content: IN_BROWSER_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
              { role: 'assistant', content: code },
              { role: 'user', content: buildRepairInstruction(violations, code) },
            ],
            onProgress,
            first.tokens,
            isReasoning,
          ),
        )
        const repaired = splitThinkAndCode(second.raw)
        // Accept the retry only if it is a real improvement: parseable and no
        // longer violating. Otherwise keep the first answer and let the
        // violation surface as "incomplete" (no silent broken insert).
        if (
          !repaired.thinkOpen &&
          repaired.code.length > 0 &&
          isParseableJs(repaired.code) &&
          detectSandboxViolations(repaired.code).length === 0
        ) {
          return { code: repaired.code, thinking: repaired.thinking, incomplete: false }
        }
        // Retry didn't fix it → the (still-violating) code is not usable.
        return reportIncomplete({
          code,
          thinking,
          reason: 'violations',
          violations: detectSandboxViolations(repaired.code),
        })
      }
    }

    // "Usable" code = a finished answer (closed think, produced code) that parses
    // and is sandbox-clean. A budget-aborted loop, an unclosed think, an empty
    // answer, or code cut off mid-statement all stay incomplete — classify which.
    const reason: InBrowserIncompleteReason | undefined = thinkOpen
      ? 'degenerate'
      : code.length === 0
        ? 'empty'
        : !isParseableJs(code)
          ? 'unparseable'
          : detectSandboxViolations(code).length > 0
            ? 'violations'
            : undefined
    if (reason) return reportIncomplete({ code, thinking, reason })
    return { code, thinking, incomplete: false }
  }
}

// Subscribe to engineAtom and keep codeGeneratorAtom in sync.
// Called once from app/model/setup.ts — same pattern as startThemeSync.
export function startCodeGeneratorBridge(): () => void {
  return engineAtom.subscribe((engine) => {
    // Reatom treats any function passed to .set() as an updater (prevValue => newValue).
    // buildGenerator() returns an async function, so we must wrap it in an updater
    // that ignores prevValue and returns the generator — otherwise Reatom calls the
    // generator with prevValue as `prompt` and stores the resulting Promise.
    codeGeneratorAtom.set(() => (engine ? buildGenerator(engine) : null))
    // Cancel slot (TARDIS-168): bind the engine's interrupt so the notebook
    // feature's Stop button can end a long run. Bound under an updater for the
    // same Reatom reason as the generator above.
    interruptInBrowserAtom.set(() => (engine ? () => engine.interruptGenerate() : null))
    // Mirror the loaded model's id into the notebook display slot. The source of
    // truth stays `web-llm.loadedModelIdAtom`; this is the legitimate place to
    // cross the feature boundary (the bridge lives in `pages/`), so NotebookHeader
    // need not import from `features/web-llm` (review PR #88 r2).
    loadedModelDisplayAtom.set(engine ? loadedModelIdAtom() : null)
  })
}
