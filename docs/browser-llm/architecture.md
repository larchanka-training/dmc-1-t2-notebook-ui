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
│   │   ├── ui/
│   │   │   └── WebLlmChat.tsx          ← full chat UI (used by LLM Playground)
│   │   └── index.ts                    ← public API
│   │
│   └── notebook/
│       ├── model/
│       │   └── codeGenerator.ts        ← DI slots: codeGeneratorAtom, loadedModelAtom
│       └── ui/
│           ├── NotebookView.tsx        ← reads codeGeneratorAtom, passes onInBrowserGenerate
│           ├── NotebookCell.tsx        ← bot button (disabled state + tooltip)
│           └── NotebookHeader.tsx      ← shows loadedModelAtom in breadcrumb
│
└── pages/
    ├── llm-playground/
    │   └── ui/
    │       └── LlmPlaygroundPage.tsx   ← shows loaded model badge; renders WebLlmChat
    │
    └── notebook/
        ├── model/
        │   └── codeGeneratorBridge.ts  ← subscribes engineAtom → sets DI slots
        └── ui/
            ├── NotebookPage.tsx        ← mounts NotebookLlmBar above NotebookView
            └── NotebookLlmBar.tsx      ← model selector + progress bar + auto-load
```

---

## DI slot pattern

The notebook feature cannot call the LLM directly. Instead it exposes two **dependency injection slots** — plain atoms that start as `null` and are filled from outside:

```ts
// src/features/notebook/model/codeGenerator.ts

// Slot 1: the generator function. null = no model loaded.
export const codeGeneratorAtom = atom<((prompt: string) => Promise<string>) | null>(
  null,
  'notebook.codeGenerator',
)

// Slot 2: the loaded model's display name. null = no model loaded.
export const loadedModelAtom = atom<string | null>(null, 'notebook.loadedModel')
```

The notebook UI reads these atoms:

- `codeGeneratorAtom` — `NotebookView` uses `!!codeGeneratorAtom()` (`hasGenerator`) to enable/disable the bot button.
- `loadedModelAtom` — `NotebookHeader` shows the model name in the breadcrumb row.

Nothing inside `features/notebook` knows _how_ the generator works or which LLM is behind it.

---

## The bridge

`pages/notebook/model/codeGeneratorBridge.ts` is the only place that imports from **both** features. It subscribes to `engineAtom` and keeps the DI slots in sync:

```ts
import { codeGeneratorAtom, loadedModelAtom } from '@/features/notebook'
import { engineAtom, modelIdAtom } from '@/features/web-llm'

export function startCodeGeneratorBridge(): () => void {
  return engineAtom.subscribe((engine) => {
    // Set the generator function (see "Storing functions in atoms" below)
    codeGeneratorAtom.set(() => (engine ? buildGenerator(engine) : null))
    // Set the display name
    loadedModelAtom.set(engine ? modelIdAtom() : null)
  })
}
```

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

## Auto-load on notebook mount

`NotebookLlmBar` auto-loads the default model when the Notebook page first mounts, using a pre-captured `wrap` created during the initial render:

```ts
// Inside reatomComponent — runs during render (in Reatom context)
const autoLoad = wrap(() => {
  if (!engineAtom() && !loadProgressAtom()) {
    modelIdAtom.set(AVAILABLE_MODELS[0]) // 1.5B Qwen Coder
    loadModelAction()
  }
})

// useEffect fires after render, outside Reatom context —
// safe because autoLoad captured context at creation time
useEffect(() => {
  autoLoad()
}, [])
```

The guard (`!engineAtom() && !loadProgressAtom()`) prevents a re-load if the user already loaded a model from the Playground page before navigating to the Notebook.

---

## SharedArrayBuffer requirement

WebLLM's WASM backend uses `SharedArrayBuffer` for parallel memory access. Browsers require **cross-origin isolation** headers to enable it:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are already set in the Vite dev server config for this project. Without them, WebLLM throws an error on initialization.
