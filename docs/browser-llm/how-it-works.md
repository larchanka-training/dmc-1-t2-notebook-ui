# How Browser LLM Works

## Overview

Language models run entirely in the user's browser via **WebLLM** (`@mlc-ai/web-llm`). No backend, no API key, no network call to any LLM provider. The model weights are downloaded once from a CDN, cached in the browser's **Cache Storage**, and executed using **WebGPU** (or WASM as a fallback).

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

Everything stays on-device. The inference runs on the GPU (WebGPU) or CPU (WASM fallback).

---

## Loading a model

### Manual (LLM Playground page)

1. Navigate to **AI → LLM Playground**.
2. Select a model from the dropdown and click **Load model**.
3. A progress bar tracks download + initialization.
4. Once the bar disappears the model is ready for chat.

### Automatic (Notebook page)

When you open the Notebook page, `NotebookLlmBar` auto-loads `Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC` (the lightest code model) if no model is already active. The same progress bar appears at the top of the page. You can change the model in the dropdown and click **Reload** to swap.

State atoms that track loading:

| Atom               | Type                   | Meaning                                          |
| ------------------ | ---------------------- | ------------------------------------------------ |
| `modelIdAtom`      | `string`               | Currently selected model ID                      |
| `loadProgressAtom` | `LoadProgress \| null` | Non-null while loading; `null` when idle or done |
| `engineAtom`       | `MLCEngine \| null`    | The live engine; `null` until load completes     |

---

## Code generation flow (step by step)

This is what happens when a user types a prompt in a **Text** cell and clicks the **Bot** button.

### Step 1 — User writes a prompt in a Text cell

A Text cell (`kind: 'markdown'`) stores its content in `cell.code()`. The user types something like:

```
function to generate fibonacci numbers
```

### Step 2 — Bot button click

The button is shown on all Text cells. It is:

- **Gray + disabled** when no model is loaded (tooltip: "Load LLM model first")
- **Active** once `codeGeneratorAtom` is non-null (i.e. a model has been loaded)

`NotebookView` passes the handler:

```tsx
onInBrowserGenerate={
  cell.kind === 'markdown'
    ? wrap(() => generateAndInsertCodeAction(cell.id))
    : undefined
}
```

`wrap` is required here — React event handlers fire outside any Reatom context, and `clearStack()` is enabled in this project.

### Step 3 — `generateAndInsertCodeAction` runs

```
src/features/notebook/model/codeGenerator.ts
```

```ts
const generator = codeGeneratorAtom() // reads the injected function
if (!generator) return // guard: no model loaded

const prompt = cell.code()
if (!prompt.trim()) return // guard: empty cell

// Pre-capture Reatom context BEFORE the first await
const insertResult = wrap((code: string) => {
  const newCell = addCell(cellId)
  updateCellCode(newCell.id, code)
  focusCell(newCell.id)
  enterEdit(newCell.id)
})

const code = await wrap(generator(prompt)) // calls the injected generator
insertResult(code) // insert the result into the notebook
```

The **pre-capture** of `insertResult` is critical — see [architecture.md](./architecture.md#pre-capture-wrap-pattern).

### Step 4 — The generator calls the LLM

`generator` is the function injected via `codeGeneratorAtom`. It was built by the bridge in `pages/notebook/model/codeGeneratorBridge.ts`:

```ts
engine.chat.completions.create({
  messages: [
    {
      role: 'system',
      content:
        'You are a JavaScript code generator. Return ONLY the JavaScript code — no markdown code fences, no explanation.',
    },
    { role: 'user', content: prompt },
  ],
  stream: false,
})
```

This is a blocking (non-streaming) call. The model runs entirely in the browser. Depending on model and hardware this takes 1–10 seconds.

### Step 5 — Strip markdown fences

The raw LLM output sometimes wraps code in fences like ` ```js ... ``` `. The bridge strips them:

````ts
raw
  .replace(/```(?:javascript|js|typescript|ts)?\n?/gi, '')
  .replace(/```/g, '')
  .trim()
````

### Step 6 — Insert the code cell

`insertResult(code)` fires and:

1. Calls `addCell(cellId)` — inserts a new `code` cell directly below the text cell.
2. Calls `updateCellCode(newCell.id, code)` — writes the generated JS.
3. Calls `focusCell` + `enterEdit` — moves the cursor there so the user can immediately edit or run.

### Step 7 — User reviews and runs

The generated code cell appears below the prompt. The user can edit it and press the **Run** button to execute it in the QuickJS sandbox (see [notebook/how-it-works.md](../notebook/how-it-works.md)).

---

## Prompt structure

When you click the bot button the model receives exactly **two messages** — nothing else:

```
[system]  You are a JavaScript code generator. Return ONLY the JavaScript
          code — no markdown code fences, no explanation, no comments unless asked.

[user]    <the full text of your Text cell>
```

**No other context is included**: no other cells, no notebook title, no chat history.

### Where the system prompt lives

It is hardcoded as a string literal in [`src/pages/notebook/model/codeGeneratorBridge.ts`](../../src/pages/notebook/model/codeGeneratorBridge.ts) inside `buildGenerator`. If you want to change what the model is instructed to do (e.g. generate TypeScript instead of JavaScript, or always add JSDoc comments), edit that string.

### The Playground has no system prompt

The chat in the LLM Playground (`sendMessageAction` in `src/features/web-llm/model/webLlm.ts`) sends only the conversation history — no system message. The model behaves as a general assistant there.

### Writing effective prompts

Because there is no surrounding context, prompts must be self-contained:

| Prompt                                     | Works? | Why                                |
| ------------------------------------------ | ------ | ---------------------------------- |
| `function to sort array of objects by key` | ✅     | Self-contained                     |
| `generate a debounce utility`              | ✅     | Self-contained                     |
| `use the data from the previous cell`      | ❌     | Model has no access to other cells |
| `add error handling to the above code`     | ❌     | No "above code" in the prompt      |

If you need the generated code to reference variables already in the notebook, include them in the text cell:

```
given: const users = [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]
write a function that filters users by name prefix
```

---

## LLM Playground chat

The Playground page (`pages/llm-playground`) exposes the full conversational interface:

- Select and load any model.
- Send messages; responses stream token-by-token back to the UI.
- Errors from loading or sending are shown inline.

Streaming works by creating a streaming completion and iterating `for await (chunk of stream)`. Because each loop iteration is an async boundary under `clearStack()`, the streaming atom updates use the **pre-capture wrap** pattern — see [architecture.md](./architecture.md#pre-capture-wrap-pattern).

---

## Current limitations

- **No streaming in code generation** — the notebook generate call uses `stream: false`. Streaming would require incremental cell updates and is more complex to implement safely.
- **Single shared engine** — `engineAtom` is a singleton. Loading a model in the Playground reuses the same engine in the notebook, and vice versa.
- **No notebook context** — the generator only receives the text cell's content as the prompt. It does not see the surrounding code cells. Adding context would improve relevance significantly.
- **WebGPU required for good performance** — without WebGPU the WASM fallback is much slower. Chrome 113+ and Edge 113+ have WebGPU enabled by default; Firefox and Safari have partial support.
