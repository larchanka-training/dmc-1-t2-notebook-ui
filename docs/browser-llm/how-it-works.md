# How Browser and Cloud LLM Work

## Overview

The in-browser tier runs entirely in the user's browser via **WebLLM**
(`@mlc-ai/web-llm`). It uses no backend provider or API key: model weights are
downloaded from a CDN, cached in the browser's **Cache Storage**, and executed
using **WebGPU** (or WASM as a fallback).

The separate **Cloud** tier sends an authenticated request through the
provider-neutral `/llm/generate` API. The backend owns provider selection and
credentials; the UI does not name or configure a cloud vendor.

### In-browser data flow

```
User's browser
┌────────────────────────────────────────────────────────────────┐
│  Main thread (React + Reatom)                                  │
│                                                                │
│  NotebookPage / LlmPlaygroundPage                              │
│       │                                                        │
│       │ loadModelAction()                                      │
│       ▼                                                        │
│  webllm.CreateMLCEngine(modelId)   ◀── weights from CDN       │
│       │                                (cached after 1st load) │
│       │ engine: MLCEngine                                      │
│       ▼                                                        │
│  engine.chat.completions.create({ messages })                  │
│       │                                                        │
│       │ WebGPU shaders / WASM runtime                         │
│       ▼                                                        │
│  Generated text streamed back to JS                            │
└────────────────────────────────────────────────────────────────┘
```

For the in-browser tier, inference stays on-device and runs on the GPU (WebGPU) or
CPU (WASM fallback). Cloud prompts and selected notebook context are sent to the
backend only when the user chooses a Cloud action.

---

## Loading a model

### Manual (LLM Playground page)

1. Navigate to **AI → LLM Playground**.
2. Select a model from the dropdown and click **Load model**.
3. A progress bar tracks download + initialization.
4. Once the bar disappears the model is ready for chat.

### Opt-in (Notebook page)

`NotebookLlmBar` exposes the same model selector and progress bar, but it does not
auto-load a multi-gigabyte model. Select a model and click **Load**; use **Reload**
to re-initialize the selected model after it is active.

State atoms that track loading:

| Atom               | Type                   | Meaning                                          |
| ------------------ | ---------------------- | ------------------------------------------------ |
| `modelIdAtom`      | `string`               | Currently selected model ID                      |
| `loadProgressAtom` | `LoadProgress \| null` | Non-null while loading; `null` when idle or done |
| `engineAtom`       | `MLCEngine \| null`    | The live engine; `null` until load completes     |

---

## Code generation flows (step by step)

This is what happens when a user types a prompt in a **Text** cell and chooses one
of its two generation controls:

- **Bot** runs the downloaded in-browser model.
- **Cloud** calls the authenticated backend and does not require a local model.

### Step 1 — User writes a prompt in a Text cell

A Text cell (`kind: 'markdown'`) stores its content in `cell.code()`. The user types something like:

```
function to generate fibonacci numbers
```

### Step 2 — Choose the in-browser or Cloud control

Both controls are shown on Text cells:

- **Bot** is disabled when no local model is loaded and becomes active once
  `codeGeneratorAtom` is non-null.
- **Cloud** is independent of `codeGeneratorAtom`. It is labelled `Beta` and is
  disabled only while its request is running or the LLM master switch is off.

`NotebookView` passes separate handlers:

```tsx
onInBrowserGenerate={
  cell.kind === 'markdown'
    ? wrap(() => generateAndInsertCodeAction(cell.id))
    : undefined
}
onCloudGenerate={
  cell.kind === 'markdown'
    ? wrap(() => cloudGenerateAndInsertCodeAction(cell.id))
    : undefined
}
```

`wrap` is required here — React event handlers fire outside any Reatom context, and `clearStack()` is enabled in this project.

### Step 3a — In-browser `generateAndInsertCodeAction` runs

```
src/features/notebook/model/codeGenerator.ts
```

```ts
const generator = codeGeneratorAtom() // reads the injected function
if (!generator) return // guard: no model loaded

const prompt = cell.code()
if (!prompt.trim()) return // guard: empty cell

// runInBrowserGeneration owns the shared lifecycle: single-flight guard, the
// live ThinkingBlock, per-cell busy/error state, Stop, and the try/finally.
await wrap(
  runInBrowserGeneration(generator, fullPrompt, cellId, {
    onStarted: () => {
      /* mark THIS cell busy, clear its previous error */
    },
    onInsert: (code) => {
      const newCell = addCell(cellId)
      updateCellCode(newCell.id, code)
      focusCell(newCell.id)
      enterEdit(newCell.id)
    },
    onError: (err) => {
      /* record a per-cell error on this row */
    },
    onSettled: () => {
      /* clear the busy cell id */
    },
  }),
)
```

The `wrap()` around `runInBrowserGeneration` is critical — the callbacks fire across the generator's internal `await` boundaries (the WebLLM stream), so the Reatom context must be restored. See [architecture.md](./architecture.md#pre-capture-wrap-pattern). The Ask-agent dialog (`agentSendInBrowserAction`) goes through the **same** helper; the only difference is the error path (it omits `onError`, so a failure keeps the in-notebook failure block instead of a per-cell error).

### Step 3b — Cloud `cloudGenerateAndInsertCodeAction` runs

```
src/features/notebook/model/cloudCodeGenerator.ts
```

The action checks the master switch and prompt, builds notebook context from the
cells above the prompt, then calls `llm.generateCode` through `@/shared/api`. A
successful response is inserted directly below the prompt using the backend's
`resultKind` (`code` or `markdown`). The inserted cell starts in `idle` state with
no execution count or output; generated code is never run automatically.

### Step 4 — The in-browser generator streams the LLM (`buildGenerator` → `streamOnce`)

`generator` is the function injected via `codeGeneratorAtom`, built by the bridge in `pages/notebook/model/codeGeneratorBridge.ts`. It returns a structured result, **not** a bare string:

```ts
type InBrowserGenerateResult = {
  code: string // the final code, ready to insert (empty when none)
  thinking: string // chain-of-thought text, for the live ThinkingBlock
  incomplete: boolean // true when no usable code was produced
  reason?: 'degenerate' | 'empty' | 'unparseable' | 'violations'
}
```

Under the hood `streamOnce` runs a **streaming** completion (`stream: true`) with `IN_BROWSER_SYSTEM_PROMPT`, the `max_tokens` backstop and sampling defaults (`temperature` / `repetition_penalty` / `frequency_penalty`). Each chunk is fed to `splitThinkAndCode` (`reasoningParser.ts`) which separates the `<think>…</think>` monologue from the code; the reasoning streams live into the `ThinkingBlock` with a token counter and a **Stop** button. For reasoning models a think-token budget interrupts a runaway reason-without-code stream.

### Step 5 — Validate, then auto-repair once if needed

The extracted code is checked by `codeValidation.ts`: `isParseableJs` (a parse, no execution) and `detectSandboxViolations` (an AST walk that flags DOM/network/timers/`getContext` in the cell and ES-module syntax). Markdown fences are stripped as part of the split. If the code parses but reaches for a forbidden API, the bridge runs **one** corrective pass naming the exact offenders; if that still violates (or the answer is unparseable/empty), the result is marked `incomplete` and **nothing is inserted** — a broken cell is worse than a clear failure.

### Step 6 — Insert the code cell (or surface the failure)

On a usable result `onInsert(code)` fires and:

1. Calls `addCell(cellId)` — inserts a new `code` cell directly below the text cell.
2. Calls `updateCellCode(newCell.id, code)` — writes the generated JS.
3. Calls `focusCell` + `enterEdit` — moves the cursor there so the user can immediately edit or run.

When the result is `incomplete`, no cell is inserted; the `ThinkingBlock` shows a reason-specific recovery hint (or just closes quietly if the user pressed Stop).

### Step 7 — User reviews and runs

The generated code cell appears below the prompt. The user can edit it and press the **Run** button to execute it in the QuickJS sandbox (see [notebook/how-it-works.md](../notebook/how-it-works.md)).

---

## Prompt structure

When you click the bot button the model receives **two messages**:

```
[system]  IN_BROWSER_SYSTEM_PROMPT — describes the QuickJS/Web-Worker sandbox
          (no DOM/network/timers/modules), the display() contract, the
          plain-by-default output rule, and the trailing hard constraints.

[user]    [optional notebook context] + <the full text of your Text cell>
```

The user message may be prefixed with **notebook context** (the cells above the prompt, per Epic 07 / §4.3) so the model can reference earlier declarations; with no context it is just the cell text. The Ask-agent dialog sends only the prompt text.

### Where the system prompt lives

It is the exported constant `IN_BROWSER_SYSTEM_PROMPT` in [`src/pages/notebook/model/codeGeneratorBridge.ts`](../../src/pages/notebook/model/codeGeneratorBridge.ts). The sandbox surface it describes mirrors the runtime in `src/features/notebook/runtime/quickjs.ts`, which stays the source of truth — change them together. The same contract is documented in `docs/ai-architecture.md §4.5` (monorepo).

### The Playground has no system prompt

The chat in the LLM Playground (`sendMessageAction` in `src/features/web-llm/model/webLlm.ts`) sends only the conversation history — no system message. The model behaves as a general assistant there.

### Writing effective prompts

Self-contained prompts always work; references to earlier cells work **when notebook context is included** (the toolbar generate prepends the cells above the prompt):

| Prompt                                     | Works? | Why                                          |
| ------------------------------------------ | ------ | -------------------------------------------- |
| `function to sort array of objects by key` | ✅     | Self-contained                               |
| `generate a debounce utility`              | ✅     | Self-contained                               |
| `use the data from the previous cell`      | ⚠️     | Only when context is sent (toolbar generate) |
| `add error handling to the above code`     | ⚠️     | Only when the earlier code is in context     |

When in doubt (or from the Ask-agent dialog, which sends only the prompt), make it self-contained by including the data in the text cell:

```
given: const users = [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]
write a function that filters users by name prefix
```

---

## LLM Playground chat

The Playground page (`pages/llm-playground`) compares both tiers side by side:

- **Local:** select and load a browser model; responses stream token-by-token.
- **Cloud:** send the same prompt through `cloudSendAction`; the response arrives
  from the authenticated backend without loading a local model.
- Errors from loading or sending are shown inline.

Local streaming creates a streaming completion and iterates
`for await (chunk of stream)`. Because each loop iteration is an async boundary
under `clearStack()`, the streaming atom updates use the **pre-capture wrap**
pattern — see [architecture.md](./architecture.md#pre-capture-wrap-pattern). The
Cloud action uses `llm.generateCode` through `@/shared/api` and appends the returned
content to its separate transcript.

---

## Current limitations

- **Single shared engine** — `engineAtom` is a singleton. Loading a model in the Playground reuses the same engine in the notebook, and vice versa. Only one in-browser generation runs at a time (a model-level single-flight guard).
- **Small local models are unreliable** — in the browser 4-bit quant a weak model can still emit broken or hallucinated code; the validator catches what it can (parse + sandbox-violation check) and refuses to insert it, but a syntactically valid hallucinated identifier only surfaces as a `ReferenceError` when the cell is run. The `DeepSeek-R1-Distill` family was dropped for this reason (see [models.md](./models.md)).
- **WebGPU required for good performance** — without WebGPU the WASM fallback is much slower. Chrome 113+ and Edge 113+ have WebGPU enabled by default; Firefox and Safari have partial support.
