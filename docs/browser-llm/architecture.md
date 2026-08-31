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
├── entities/
│   └── llm-availability/
│       └── model/
│           └── llmAvailability.ts      ← llmEnabledAtom (master switch) + entry-point inventory
│
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

## The LLM master switch (`llmEnabledAtom`)

A per-user switch that turns LLM features off entirely (roadmap Step 8b; decision:
`docs/specs/llm-provider-toggle-security-contract.md` in the workspace repo). While
off, **no cloud request is sent and no model is downloaded or run** — including the
sign-in auto-load, which is the case the switch exists for: a user who turned LLM
off must never have a multi-gigabyte model pulled for them.

It lives in `entities/llm-availability` rather than `features/settings` because
three features and two pages read it and a feature must not import a sibling
feature; `entities` is the lowest layer all of them can reach. Like the other
per-user settings it is hydrated from and written back to `settings:<userId>` by
`app/model/settingsSync.ts`, and it defaults to **enabled**, so a record written
before Step 8b (with no `llmEnabled` key) leaves the user's behaviour unchanged.

Every generation and download path checks it — the authoritative list of guarded
entry points is the comment in `llmAvailability.ts`, kept next to the atom so a new
call site has one obvious place to consult. Guards live in the **actions**, not only
in the UI: the buttons are disabled too, but a model-layer guard is what makes "no
accidental request" true for every caller.

**It is a UX preference, not a security control.** It is device-local state derived
from user-editable `localStorage`. The real controls on `POST /llm/generate` are
server-side and unchanged: authentication, the per-user rate limit, and the request
byte caps. Do not describe it as authorization, and do not rely on it to keep anyone
out of anything.

---

## Cloud tier availability (Step 8d-2)

The cloud tier is in **limited testing**. The backend can restrict
`POST /llm/generate` to an allowlist of developer accounts (`LLM_ALLOWED_EMAILS`);
while that is set, cloud generation is not generally available.

The UI reflects this in two places, and the split matters:

- **Unconditional `Beta` labelling** on every cloud entry point (cell toolbar
  tooltip, Ask-agent dialog button, playground panel), with a hint explaining that
  the in-browser model works for everyone. The client **cannot** know whether the
  signed-in account is allowlisted — that is a server-side decision, deliberately
  not exposed, because an endpoint answering "am I allowlisted?" would leak the
  policy and invite probing. So the UI states the feature's _status_; it does not
  predict the verdict.
- **A specific message after an actual 403**, keyed off the HTTP **status together
  with the error code** — `403` **and** `llm_access_denied`. The backend uses
  `llm_access_denied` for two different things: with `403` it means this account is
  outside the private test group (permanent — retrying is pointless), while with
  `500` it means the _server's_ provider credentials were rejected (a real outage,
  worth retrying). The status alone is not sufficient either: a future `403`
  carrying a different code is not an allowlist denial and falls through to generic
  handling. Treating the 403 as "temporarily unavailable" would invite a retry loop
  against something that can never succeed.

All three surfaces go through one `formatCloudLlmError`, so a new branch cannot
reach some of them and miss others — which is exactly how the Ask-agent dialog was
left showing a raw `Generation failed: …` for an allowlist 403.

Copy lives in one place, `features/notebook/lib/cloudLlmAvailability.ts`, and is
re-exported from the feature's public API so the playground page renders the same
wording instead of forking it. Wording rules are in that file's header: say limited
testing rather than broken, promise no date, and never imply a retry will help.

The UI also no longer names a cloud vendor. Since Step 8d-1 the backend selects the
adapter from config, so a vendor name in the interface goes stale the moment it is
switched.

---

## SharedArrayBuffer requirement

WebLLM's WASM backend uses `SharedArrayBuffer` for parallel memory access. Browsers require **cross-origin isolation** headers to enable it:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are already set in the Vite dev server config for this project. Without them, WebLLM throws an error on initialization.
