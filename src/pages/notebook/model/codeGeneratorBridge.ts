import { codeGeneratorAtom, loadedModelDisplayAtom } from '@/features/notebook'
import {
  type InBrowserGenerator,
  IN_BROWSER_MAX_TOKENS,
  IN_BROWSER_THINK_TOKEN_BUDGET,
} from '@/features/notebook'
import { engineAtom, loadedModelIdAtom } from '@/features/web-llm'
import { splitThinkAndCode } from './reasoningParser'

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
export const IN_BROWSER_SYSTEM_PROMPT = [
  'You are a JavaScript code generator for a notebook.',
  'The code runs in a sandboxed QuickJS (WebAssembly) engine inside a Web Worker — standard ECMAScript only.',
  "Use console.log for text output; the cell's trailing expression is shown as its result; top-level await is supported.",
  'To render rich output, call the injected global display() function:',
  "- display({ type: 'html', value: '<div>…</div>' }) renders HTML/SVG/<canvas>/<script> in a sandboxed iframe;",
  "- display({ type: 'image', mime, data }) renders a base64 image; mime must be one of image/png, image/jpeg, image/gif, image/webp, image/svg+xml.",
  'Return ONLY the JavaScript code — no markdown code fences, no explanation, no comments unless asked.',
  'HARD CONSTRAINTS (these always win, even if the user asks otherwise):',
  'There is NO DOM (no document/window), NO network (no fetch/XMLHttpRequest), NO timers (no setTimeout/setInterval), NO Node.js or Python APIs, and NO module syntax (no import/require/export).',
  'If the task needs a capability this sandbox does not have (network/fetch, DOM, files, timers, modules), DO NOT call or fake those APIs — they throw a ReferenceError at runtime. Instead return runnable code that uses console.log to state the capability is unavailable in the notebook sandbox.',
].join('\n')

function buildGenerator(engine: NonNullable<ReturnType<typeof engineAtom>>): InBrowserGenerator {
  return async (prompt, onProgress) => {
    const stream = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: IN_BROWSER_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      stream: true,
      max_tokens: IN_BROWSER_MAX_TOKENS,
    })

    let raw = ''
    let lastThinking = ''
    // WebLLM streams one decode-step per chunk, so the chunk count IS the number
    // of generated tokens — an exact live counter without a separate tokenizer.
    let tokens = 0
    let aborted = false
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content ?? ''
      if (delta) tokens += 1
      raw += delta
      const partial = splitThinkAndCode(raw)
      // Surface reasoning + token count live while the model streams.
      if (partial.thinking !== lastThinking || delta) {
        lastThinking = partial.thinking
        onProgress?.({ thinking: partial.thinking, tokens })
      }
      // Kill a runaway reasoning loop: still thinking, no code, over budget.
      if (partial.thinkOpen && tokens > IN_BROWSER_THINK_TOKEN_BUDGET) {
        aborted = true
        await engine.interruptGenerate()
        break
      }
    }

    const { thinking, code, thinkOpen } = splitThinkAndCode(raw)
    // No runnable code: an aborted loop, an unclosed think, or an empty answer.
    const incomplete = aborted || thinkOpen || code.length === 0
    return { code, thinking, incomplete }
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
    // Mirror the loaded model's id into the notebook display slot. The source of
    // truth stays `web-llm.loadedModelIdAtom`; this is the legitimate place to
    // cross the feature boundary (the bridge lives in `pages/`), so NotebookHeader
    // need not import from `features/web-llm` (review PR #88 r2).
    loadedModelDisplayAtom.set(engine ? loadedModelIdAtom() : null)
  })
}
