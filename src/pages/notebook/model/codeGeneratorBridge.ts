import { codeGeneratorAtom, loadedModelDisplayAtom } from '@/features/notebook'
import { engineAtom, loadedModelIdAtom } from '@/features/web-llm'

// System prompt for the In-browser agent (T1). It must describe the REAL
// runtime so the model stops emitting unrunnable code (TARDIS-168): cells run in
// a QuickJS (WebAssembly) engine inside a Web Worker — plain ECMAScript, with no
// DOM, no network, no timers, no Node/Python APIs and no module syntax. Rich
// output goes ONLY through the injected global `display()` (see
// `features/notebook/runtime/quickjs.ts` — the source of truth for the sandbox
// surface and the allowed image MIME types).
export const IN_BROWSER_SYSTEM_PROMPT = [
  'You are a JavaScript code generator for a notebook.',
  'Return ONLY the JavaScript code — no markdown code fences, no explanation, no comments unless asked.',
  'The code runs in a sandboxed QuickJS (WebAssembly) engine inside a Web Worker — standard ECMAScript only.',
  'There is NO DOM (no document/window), NO network (no fetch/XMLHttpRequest), NO timers (no setTimeout/setInterval), NO Node.js or Python APIs, and NO module syntax (no import/require/export).',
  "Use console.log for text output; the cell's trailing expression is shown as its result; top-level await is supported.",
  'To render rich output, call the injected global display() function:',
  "- display({ type: 'html', value: '<div>…</div>' }) renders HTML/SVG/<canvas>/<script> in a sandboxed iframe;",
  "- display({ type: 'image', mime, data }) renders a base64 image; mime must be one of image/png, image/jpeg, image/gif, image/webp, image/svg+xml.",
].join('\n')

function buildGenerator(engine: NonNullable<ReturnType<typeof engineAtom>>) {
  return async (prompt: string): Promise<string> => {
    const response = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: IN_BROWSER_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      stream: false,
    })
    const raw = response.choices[0]?.message.content ?? ''
    return raw
      .replace(/```(?:javascript|js|typescript|ts)?\n?/gi, '')
      .replace(/```/g, '')
      .trim()
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
