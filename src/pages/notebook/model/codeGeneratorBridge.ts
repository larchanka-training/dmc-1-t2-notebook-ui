import { codeGeneratorAtom, loadedModelDisplayAtom } from '@/features/notebook'
import { engineAtom, loadedModelIdAtom } from '@/features/web-llm'

function buildGenerator(engine: NonNullable<ReturnType<typeof engineAtom>>) {
  return async (prompt: string): Promise<string> => {
    const response = await engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You are a JavaScript code generator. Return ONLY the JavaScript code — no markdown code fences, no explanation, no comments unless asked.',
        },
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
