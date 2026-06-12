# Task: Wire Cloud LLM Code Generation

## Goal

Connect the existing **Cloud agent button** (the `<Cloud>` icon on Text cells) to the
backend `POST /llm/generate` endpoint so users can generate JavaScript code via AWS
Bedrock without loading a local model.

When the user clicks the Cloud button on a Text cell, the backend generates code
(guard-checked, syntax-validated, auto-repaired) and inserts it as a new code cell
directly below — identical UX to the in-browser Bot button.

Keep the implementation **simple**:

- use the existing shared API facade `llm.generateCode()`
- call the backend only in `mode: "generate"`
- do **not** implement edit-mode / `baseCode`
- do **not** add streaming
- do **not** auto-run the inserted code cell

---

## What already exists — do NOT recreate

| Already done                                 | Where                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| API facade function `generateCode()`         | `src/shared/api/llm.ts`                                                    |
| OpenAPI spec + generated types               | `openapi/llm.openapi.yaml`, `src/shared/api/generated/openapi-ts/llm.d.ts` |
| Cloud button in cell toolbar (T2)            | `src/features/notebook/ui/NotebookCell.tsx` lines ~294–304                 |
| In-browser (T1) bot button fully wired       | same file, for reference on the pattern                                    |
| Error classes `RateLimitedError`, `ApiError` | `src/shared/api/errors.ts`                                                 |
| Cell insert helpers                          | `src/features/notebook/model/notebook.ts` — `addCell`, `updateCellCode`    |
| Cell focus helpers                           | `src/features/notebook/model/cellMode.ts` — `focusCell`, `enterEdit`       |

Read those files before starting. The pattern to follow for the new action is
identical to `generateAndInsertCodeAction` in
`src/features/notebook/model/codeGenerator.ts`.

---

## Architecture constraints

- **`clearStack()` is enabled** — every React event handler and every atom/action
  call after an `await` **must** use `wrap`. Read
  `docs/architecture/reatom.md` before writing any async action or event handler.
- **Pre-capture `wrap`** — create `wrap(fn)` synchronously at the top of an async
  action body, before the first `await`. Calling `wrap()` after an `await` throws
  `ReatomError: missing async stack`.
- **No cross-feature imports** — `features/notebook` cannot import from
  `features/web-llm`. It **can** import from `@/shared/api` (shared layer is always
  allowed).
- **Public API only** — export new atoms/actions through
  `src/features/notebook/index.ts`; consumers import from `@/features/notebook`,
  not from internal paths.
- **Authenticated backend call** — the endpoint requires a Bearer token. Use the
  existing shared authenticated client through `llm.generateCode()`;
  do not call `fetch()` directly.

---

## Step-by-step implementation

### Step 1 — Create the cloud generator action

Create **`src/features/notebook/model/cloudCodeGenerator.ts`**:

```ts
import { action, wrap } from '@reatom/core'
import { withAsync } from '@reatom/core'
import { llm } from '@/shared/api'
import { RateLimitedError } from '@/shared/api/errors'
import { cellsAtom, addCell, updateCellCode, notebookTitleAtom } from './notebook'
import { enterEdit, focusCell } from './cellMode'

export const cloudGenerateAndInsertCodeAction = action(async (cellId: string) => {
  const cell = cellsAtom().find((c) => c.id === cellId)
  if (!cell) return

  const prompt = cell.code()
  if (!prompt.trim()) return

  // Build context: up to 10 cells before the current one (code + markdown).
  const cells = cellsAtom()
  const idx = cells.findIndex((c) => c.id === cellId)
  const contextCells: llm.LlmContextCell[] = cells
    .slice(Math.max(0, idx - 10), idx)
    .map((c) => ({ kind: c.kind === 'code' ? 'code' : 'text', source: c.code() }))

  // Pre-capture Reatom context BEFORE the first await.
  // After await, the clearStack context is gone — these wrappers
  // let us safely update atoms from the post-await continuation.
  const insertResult = wrap((code: string) => {
    const newCell = addCell(cellId)
    updateCellCode(newCell.id, code)
    focusCell(newCell.id)
    enterEdit(newCell.id)
  })

  const response = await wrap(
    llm.generateCode({
      prompt,
      context: contextCells,
      notebookTitle: notebookTitleAtom() || undefined,
      language: 'javascript',
    }),
  )

  insertResult(response.content)
}, 'notebook.cells.cloudGenerate').extend(withAsync())
```

**Why pre-capture matters:** `wrap(fn)` captures the current Reatom execution
context at call time. After `await wrap(llm.generateCode(...))` the context is
gone. Creating `insertResult` before the await lets us call Reatom actions
(`addCell`, `updateCellCode`, etc.) safely afterwards.

---

### Step 2 — Export from the feature's public API

In **`src/features/notebook/index.ts`**, add to the existing exports:

```ts
export { cloudGenerateAndInsertCodeAction } from './model/cloudCodeGenerator'
```

---

### Step 3 — Add props to `NotebookCell`

In **`src/features/notebook/ui/NotebookCell.tsx`**:

**Add to `NotebookCellProps` interface** (near the existing `onInBrowserGenerate`):

```ts
onCloudGenerate?: () => void
isCloudGenerating?: boolean
```

**Add to the destructured props** in `NotebookCell(...)`:

```ts
onCloudGenerate,
isCloudGenerating,
```

**Replace the existing presentational cloud button** (the one with no `onClick`,
around line 294) with a wired version that mirrors the in-browser button:

```tsx
<Tooltip>
  <TooltipTrigger
    render={
      <button
        type="button"
        aria-label={agentCloudLabel}
        className={AGENT_BTN}
        disabled={isCloudGenerating}
        onClick={onCloudGenerate}
      >
        {isCloudGenerating ? (
          <Loader2 className="size-[15px] animate-spin" />
        ) : (
          <Cloud className="size-[15px]" />
        )}
      </button>
    }
  />
  <TooltipContent>{agentCloudLabel}</TooltipContent>
</Tooltip>
```

`Loader2` is already imported. The button is always visible on all cell kinds
(the `agentCloudLabel` already handles code vs. markdown label text).

---

### Step 4 — Wire in `NotebookView`

In **`src/features/notebook/ui/NotebookView.tsx`**:

**Add to imports** at the top (join the existing codeGenerator import):

```ts
import { cloudGenerateAndInsertCodeAction } from '../model/cloudCodeGenerator'
```

**Inside `NotebookRow`**, add two reads alongside the existing `isGenerating`:

```ts
const isCloudGenerating = !cloudGenerateAndInsertCodeAction.ready()
const cloudGenerateError = cloudGenerateAndInsertCodeAction.error()
```

**Pass new props to `<NotebookCell>`**:

```tsx
onCloudGenerate={
  cell.kind === 'markdown'
    ? wrap(() => cloudGenerateAndInsertCodeAction(cell.id))
    : undefined
}
isCloudGenerating={isCloudGenerating}
```

**Add error display** below the cell (after the existing `generateError` block):

```tsx
{
  cloudGenerateError && (
    <p className="px-3 py-1 text-xs text-destructive">
      {formatCloudGenerateError(cloudGenerateError)}
    </p>
  )
}
```

**Add the error formatter** as a module-level helper in `NotebookView.tsx`
(not inside the component):

```ts
import { RateLimitedError } from '@/shared/api/errors'

function formatCloudGenerateError(err: Error): string {
  if (err instanceof RateLimitedError) {
    const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : ''
    return `Rate limit reached.${wait}`
  }
  const msg = err.message.toLowerCase()
  if (msg.includes('prompt_rejected') || msg.includes('rejected')) {
    return 'Prompt was flagged by the safety filter.'
  }
  if (msg.includes('llm_timeout') || msg.includes('timeout')) {
    return 'Cloud generation timed out. Try again or use the local model.'
  }
  if (msg.includes('llm_unavailable') || msg.includes('503') || msg.includes('502')) {
    return 'Cloud AI is temporarily unavailable. Try the local model instead.'
  }
  return `Cloud generation failed: ${err.message}`
}
```

---

### Step 5 — Verify types compile

```bash
pnpm typecheck
pnpm lint
```

Fix any type errors before moving on. Common issues:

- `RateLimitedError` not imported — add `import { RateLimitedError } from '@/shared/api/errors'`
- `onCloudGenerate` and `isCloudGenerating` not in `NotebookCellProps` — check Step 3

---

## API contract summary

**Request** `POST /llm/generate`:

```json
{
  "prompt": "function to generate fibonacci numbers",
  "language": "javascript",
  "mode": "generate",
  "notebookTitle": "My notebook",
  "context": [
    { "kind": "code", "source": "const x = 42" },
    { "kind": "text", "source": "helper utilities" }
  ]
}
```

- `prompt` — required, 1–8 000 chars, the text cell content
- `context` — optional, up to 10 preceding cells for context; helps the model know
  what variables/functions are already defined
- `notebookTitle` — optional, helps the model understand the domain
- `language` — `"javascript"` (default) or `"typescript"`
- `mode` — `"generate"` (default) or `"edit"` (for improving existing code;
  requires `baseCode`)

**Response** `200 OK`:

```json
{
  "content": "function fibonacci(n) { ... }",
  "model": "eu.amazon.nova-lite-v1:0",
  "tier": "backend",
  "tokens": { "prompt": 120, "completion": 85 },
  "requestId": "uuid"
}
```

`content` is clean executable JavaScript — fences and prose already stripped by
the backend.

**Error responses to handle**:

| Status | `code` field                  | User-facing message                          |
| ------ | ----------------------------- | -------------------------------------------- |
| 401    | `invalid_token`               | User is not signed in / session expired      |
| 422    | `prompt_rejected`             | Prompt flagged by safety filter              |
| 422    | `code_validation_failed`      | Generated code failed validation             |
| 422    | `request_too_large`           | Prompt/context payload too large             |
| 429    | `rate_limited`                | Rate limit; `Retry-After` header has seconds |
| 502    | `llm_provider_error`          | Backend Bedrock call failed                  |
| 503    | `llm_provider_not_configured` | Bedrock not set up                           |
| 504    | `llm_timeout`                 | 30-second pipeline cap exceeded              |

`RateLimitedError` (from `@/shared/api/errors`) has a `.retryAfter` field (seconds)
already parsed from the response header.

---

## Pipeline the backend runs (for context)

The backend does more than a raw LLM call:

1. **Guard model** (`amazon.nova-micro`) — classifies the prompt for safety; rejects
   if unsafe → `422 prompt_rejected`
2. **Generator model** (`amazon.nova-lite`) — generates JavaScript
3. **esbuild syntax validation** — parses the output; if invalid, sends back to
   the generator with the error message (up to 2 repair attempts)
4. Returns clean, validated code

The frontend does **not** need to strip markdown fences — the backend already does it.

The success payload also includes `resultKind: "code"` and `requestId`, but for this
UI task the inserted cell only needs `response.content`.

---

## Checklist

- [ ] `src/features/notebook/model/cloudCodeGenerator.ts` created
- [ ] `cloudGenerateAndInsertCodeAction` exported from `src/features/notebook/index.ts`
- [ ] `onCloudGenerate` and `isCloudGenerating` props added to `NotebookCellProps`
- [ ] Cloud button in `NotebookCell.tsx` has `onClick`, `disabled`, and spinner
- [ ] `NotebookView.tsx` passes `onCloudGenerate` and `isCloudGenerating` to `NotebookCell`
- [ ] Error display below cell with `formatCloudGenerateError` for all error types
- [ ] `pnpm typecheck` passes with no errors
- [ ] `pnpm lint` passes with no errors
- [ ] Manual test: type a prompt in a Text cell → click Cloud button → spinner shows
      → code cell inserted below with generated code
- [ ] Manual test: rate-limited error shows the retry countdown message
- [ ] Manual test: empty Text cell → Cloud button click → nothing happens (guard in action)

---

## Notes

- The cloud button is always visible (no `generatorLoaded` gate needed — no local
  model required). If the user is not authenticated the API returns `401`; surface
  it as a simple sign-in/session-expired error message.
- Do not auto-run the inserted code cell. The user must press Run explicitly
  (same as the in-browser path).
- `cloudGenerateAndInsertCodeAction.error()` is a global atom shared across all
  `NotebookRow` instances. Reset it when a new generation starts if you want
  per-cell isolation; for now a shared "last error" display is acceptable.
- Context cells are capped at 10 by the backend schema (`max_length: 10` on the
  `context` array). The implementation above already respects this with `.slice`.
- The backend also enforces a total request-body byte limit. Even with valid field
  lengths, a very large combined `prompt + context` can return `422 request_too_large`.
