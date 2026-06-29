# Architecture

## Feature boundaries

The browser LLM functionality spans three layers of the [fractal frontend architecture](../architecture/folder-structure.md):

```
pages/notebook          ← wires features together (bridge)
pages/llm-playground    ← uses web-llm directly

features/web-llm        ← owns the engine, loading, chat
features/notebook       ← owns the notebook; has a DI slot for code generation
```

`features/web-llm` and `features/notebook` **never import from each other** — cross-feature imports are forbidden. The page layer (`pages/notebook`) sits above both and is the only place that knows about both.

---

## File map

```
src/
├── features/
│   ├── web-llm/
│   │   ├── model/
│   │   │   └── webLlm.ts               ← atoms, actions, AVAILABLE_MODELS
│   │   └── index.ts                    ← public API
│   │
│   └── notebook/
│       ├── model/
│       │   └── codeGenerator.ts        ← DI slot: codeGeneratorAtom
│       └── ui/
│           ├── NotebookView.tsx        ← reads codeGeneratorAtom, passes onInBrowserGenerate
│           ├── NotebookCell.tsx        ← bot button (disabled state + tooltip)
│           └── NotebookHeader.tsx      ← shows the loaded model (loadedModelIdAtom) in breadcrumb
│
└── pages/
    ├── llm-playground/
    │   └── ui/
    │       └── LlmPlaygroundPage.tsx   ← local + cloud panels with their own model selector
    │
    └── notebook/
        ├── model/
        │   └── codeGeneratorBridge.ts  ← subscribes engineAtom → sets the DI slot
        └── ui/
            ├── NotebookPage.tsx        ← mounts NotebookLlmBar above NotebookView
            └── NotebookLlmBar.tsx      ← model selector + progress bar + Load/Reload button
```

---

## DI slot pattern

The notebook feature cannot call the LLM directly. Instead it exposes a **dependency injection slot** — a plain atom that starts as `null` and is filled from outside:

```ts
// src/features/notebook/model/codeGenerator.ts

// The generator function. null = no model loaded.
export const codeGeneratorAtom = atom<((prompt: string) => Promise<string>) | null>(
  null,
  'notebook.codeGenerator',
)
```

The notebook UI reads this atom:

- `codeGeneratorAtom` — `NotebookView` uses `!!codeGeneratorAtom()` (`hasGenerator`) to enable/disable the bot button.

The loaded model's **name** is NOT a separate notebook-side slot. There is one
source of truth in `features/web-llm` — `loadedModelIdAtom` (the id of the model
actually loaded into the engine) — which `NotebookHeader` reads directly for the
breadcrumb (TARDIS-167 / review PR #88). A second notebook-side `loadedModelAtom`
was removed to avoid two copies of the same fact drifting apart.

Nothing inside `features/notebook` knows _how_ the generator works or which LLM is behind it.

---

## The bridge

`pages/notebook/model/codeGeneratorBridge.ts` is the only place that imports from **both** features. It subscribes to `engineAtom` and keeps the DI slot in sync:

```ts
import { codeGeneratorAtom } from '@/features/notebook'
import { engineAtom } from '@/features/web-llm'

export function startCodeGeneratorBridge(): () => void {
  return engineAtom.subscribe((engine) => {
    // Set the generator function (see "Storing functions in atoms" below)
    codeGeneratorAtom.set(() => (engine ? buildGenerator(engine) : null))
  })
}
```

The loaded model's name is owned by `features/web-llm` (`loadedModelIdAtom`, set
inside `loadModelAction`), so the bridge no longer mirrors it.

The bridge is started once at app boot from `src/app/model/setup.ts`:

```ts
rootFrame.run(() => {
  startThemeSync()
  startCodeGeneratorBridge() // ← registers the subscription
})
```

---

## Storing functions in Reatom atoms

Reatom's `.set()` is overloaded: if you pass a **function**, it is called as an updater `(prevValue) => newValue` — the function is never stored directly.

This means you **cannot** do:

```ts
// ❌ Reatom calls buildGenerator(engine) with prevState as `prompt`
//    and stores the resulting Promise, not the function.
codeGeneratorAtom.set(buildGenerator(engine))
```

The correct pattern is to wrap in an updater that ignores `prevValue`:

```ts
// ✅ Reatom calls the outer function with prevState (which is ignored),
//    gets back buildGenerator(engine) (the async function), and stores it.
codeGeneratorAtom.set(() => (engine ? buildGenerator(engine) : null))
```

---

## Pre-capture wrap pattern

`clearStack()` is enabled in `src/setup.ts`. This means every async boundary that touches atoms must be wrapped. The tricky case is when you need to update atoms **after** an `await` that crosses outside the Reatom context.

The rule: **call `wrap(fn)` synchronously before the first `await`** to capture the current context. The resulting function can be called safely after any number of awaits.

### In `generateAndInsertCodeAction`

```ts
export const generateAndInsertCodeAction = action(async (cellId: string) => {
  // ... guards ...

  // ✅ Pre-capture BEFORE the await
  const insertResult = wrap((code: string) => {
    const newCell = addCell(cellId)
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
  })

  const code = await wrap(generator(prompt)) // ← async boundary

  insertResult(code) // ✅ safe — context was captured above
}, 'notebook.cells.generateAndInsert').extend(withAsync())
```

### In `sendMessageAction` (streaming)

For streaming, each `for await` iteration is a new async boundary. Pre-capture both the per-chunk updater and the finalizer before the loop:

```ts
// ✅ Both captured before any await
const setStreaming = wrap((text: string) => streamingResponseAtom.set(text))
const finalize = wrap((text: string) => {
  messagesAtom.set((msgs) => [...msgs, { role: 'assistant', content: text }])
  streamingResponseAtom.set('')
})

const stream = await wrap(engine.chat.completions.create({ ... }))

let fullResponse = ''
for await (const chunk of stream) {
  fullResponse += chunk.choices[0]?.delta.content ?? ''
  setStreaming(fullResponse)   // ✅ safe
}
finalize(fullResponse)         // ✅ safe
```

### Cannot wrap inside a loop

```ts
// ❌ Reatom context is gone on the second iteration and beyond
for await (const chunk of stream) {
  wrap(() => streamingResponseAtom.set(accumulated))()
}
```

---

## Opt-in model loading

Model download is **opt-in** (TARDIS-167 №4). `NotebookLlmBar` does NOT auto-load a
model on mount — pulling a multi-GB model into the browser without consent ate the
memory of users who may not have it. The model loads ONLY when the user clicks
**Load model**. While no model is loaded, the in-browser generate buttons (cell
toolbar + "Ask agent") stay disabled with a "load a model first" tooltip, gated on
`codeGeneratorAtom` being `null`.

The selected model id is a PER-USER preference (TARDIS-181): `modelIdAtom` is a
plain in-memory atom, hydrated/persisted under the signed-in user's settings
namespace (`settings:<userId>`) by `features/settings`, so two accounts on one
browser keep separate model choices. The set of already-downloaded model ids
(`downloadedModelIdsAtom`) stays DEVICE-GLOBAL in `localStorage`, because it
mirrors the WebLLM Cache Storage shared by every user of the browser; it is
reconciled against the real cache on startup (`reconcileDownloadedModelsAction` →
`webllm.hasModelInCache`), so an evicted/cleared model loses its highlight instead
of showing a stale check.

---

## SharedArrayBuffer requirement

WebLLM's WASM backend uses `SharedArrayBuffer` for parallel memory access. Browsers require **cross-origin isolation** headers to enable it:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are already set in the Vite dev server config for this project. Without them, WebLLM throws an error on initialization.
