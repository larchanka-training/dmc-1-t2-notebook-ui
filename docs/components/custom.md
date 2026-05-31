# Custom Components

Custom components are placed by **scope**, not by type:

- Generic, app-wide UI without business logic → `src/shared/ui/`
- Belongs to a specific feature → `src/features/<feature>/ui/`
- Belongs to a specific page → `src/pages/<page>/ui/` (or inline in the page file)

See [Folder Structure](../architecture/folder-structure.md) for layer rules.

---

## NotebookCell

**File:** `src/features/notebook/ui/NotebookCell.tsx`
**Import:** `import { NotebookCell } from '@/features/notebook'`
**Used in:** `NotebookView` (the live notebook) and `CustomComponentsPage` (the gallery)

The presentational building block of the notebook. Renders a dark code editor with an output area. The component is fully **stateless** — its parent (`NotebookView`) manages all state via Reatom and passes plain values and callbacks as props.

### Props

| Prop               | Type                                                                                  | Required | Description                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `executionCount`   | `number \| null`                                                                      | no       | Run counter shown as `[n]`; `null` (the default) renders `[ ]`                                      |
| `kind`             | `'code' \| 'markdown'`                                                                | no       | Cell type; `markdown` swaps the run button for a text label                                         |
| `code`             | `string`                                                                              | yes      | Source code / markdown displayed in the textarea                                                    |
| `output`           | `OutputItem[]`                                                                        | no       | Structured output items (stdout / stderr / result / error / html / image) rendered below the editor |
| `status`           | `'idle' \| 'running' \| 'done' \| 'error' \| 'interrupted' \| 'timeout' \| 'skipped'` | no       | Controls border colour and run/stop button                                                          |
| `viewMode`         | `'edit' \| 'preview'`                                                                 | no       | Markdown cells only: edit vs rendered preview                                                       |
| `isFirst`          | `boolean`                                                                             | no       | Disables the move-up button                                                                         |
| `isLast`           | `boolean`                                                                             | no       | Disables the move-down button                                                                       |
| `readOnly`         | `boolean`                                                                             | no       | Prevents editing the textarea                                                                       |
| `onCodeChange`     | `(code: string) => void`                                                              | no       | Called on every keystroke                                                                           |
| `onViewModeChange` | `(mode: CellViewMode) => void`                                                        | no       | Markdown cells only: toggles edit/preview                                                           |
| `onRun`            | `() => void`                                                                          | no       | Called when the play button or Cmd+Enter is pressed                                                 |
| `onStop`           | `() => void`                                                                          | no       | Called when the stop button is pressed while the cell is `running`                                  |
| `onDelete`         | `() => void`                                                                          | no       | Called when the trash icon is clicked                                                               |
| `onMoveUp`         | `() => void`                                                                          | no       | Called when the ↑ button is clicked                                                                 |
| `onMoveDown`       | `() => void`                                                                          | no       | Called when the ↓ button is clicked                                                                 |

### Usage — static display (e.g. component gallery)

```tsx
import { NotebookCell } from '@/features/notebook'
;<NotebookCell
  executionCount={1}
  code={`console.log("hello")`}
  output={[{ type: 'stdout', text: 'hello' }]}
  status="done"
  readOnly
/>
```

### Usage — wired to Reatom state

In the live notebook, the cell's fields are **atomized** (`code`, `output`, `status`, `executionCount`, `viewMode` are atoms). The parent component (`NotebookView`) reads each atom and passes the plain value down. Reatom-touching callbacks are wrapped with `wrap` so they preserve async context (see [reatom.md](../architecture/reatom.md)):

```tsx
import { wrap } from '@reatom/core'
import { NotebookCell } from '@/features/notebook'
import { updateCellCode, runCell, stopCell, deleteCell, moveCell } from '@/features/notebook'
;<NotebookCell
  executionCount={cell.executionCount()}
  kind={cell.kind}
  code={cell.code()}
  output={cell.output()}
  status={cell.status()}
  viewMode={cell.viewMode()}
  isFirst={idx === 0}
  isLast={idx === cells.length - 1}
  onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
  onViewModeChange={wrap((mode) => cell.viewMode.set(mode))}
  onRun={wrap(() => runCell(cell.id))}
  onStop={wrap(() => stopCell(cell.id))}
  onDelete={wrap(() => deleteCell(cell.id))}
  onMoveUp={wrap(() => moveCell(cell.id, -1))}
  onMoveDown={wrap(() => moveCell(cell.id, 1))}
/>
```

### Status visual reference

| Status        | Border                                | Run button   | Notes                                            |
| ------------- | ------------------------------------- | ------------ | ------------------------------------------------ |
| `idle`        | default                               | ▶ green      | —                                                |
| `running`     | left primary bar                      | ■ stop (red) | Run is swapped for a Stop button                 |
| `done`        | default                               | ▶ green      | —                                                |
| `error`       | red (`border-destructive`)            | ▶ green      | Output carries an `error` item                   |
| `interrupted` | amber (`border-amber-500/60`)         | ▶ green      | User pressed Stop; output notes the interruption |
| `timeout`     | amber (`border-amber-500/60`)         | ▶ green      | Run exceeded the timeout                         |
| `skipped`     | dashed (`border-muted-foreground/40`) | ▶ green      | Run All halted on an earlier cell's failure      |

### Design notes

- Editor background is `#1e1e2e` (Catppuccin Mocha dark) with `#cdd6f4` text — deliberate visual contrast from the rest of the theme.
- The textarea auto-resizes to fit content using `scrollHeight`.
- Action buttons are visible by default (no hover gate) in the current implementation.

---

## NotebookView

**File:** `src/features/notebook/ui/NotebookView.tsx`
**Import:** `import { NotebookView } from '@/features/notebook'`
**Used in:** `NotebookPage`

The container that reads `cellsAtom`, renders the list of `NotebookCell`s, and exposes "Add Cell" buttons. This is where Reatom actions (`addCell`, `runCell`, `deleteCell`, `moveCell`, `updateCellCode`) get wired into DOM event handlers via `wrap`.

Most application code shouldn't reach for `NotebookView` directly — it's the feature's top-level view, mounted by the notebook page.

---

## Inline gallery components (`CustomComponentsPage`)

The following are tiny components defined inline in `src/pages/custom-components/ui/CustomComponentsPage.tsx` purely to showcase patterns. They are **not exported** and not meant to be reused — copy them out into `shared/ui/` if you need them in another place.

### Badge

A compact status label with semantic colour variants. Lighter than the shadcn `Badge` — no border, rounded-full shape.

| Prop    | Type                                             | Default     | Description                |
| ------- | ------------------------------------------------ | ----------- | -------------------------- |
| `label` | `string`                                         | —           | Text content               |
| `color` | `'default' \| 'success' \| 'warning' \| 'error'` | `'default'` | Background and text colour |

```tsx
<Badge label="Active" color="success" />
<Badge label="Pending" color="warning" />
<Badge label="Failed" color="error" />
<Badge label="Unknown" />
```

| Value     | Background         | Text                    |
| --------- | ------------------ | ----------------------- |
| `default` | `bg-muted`         | `text-muted-foreground` |
| `success` | `bg-green-500/15`  | `text-green-600`        |
| `warning` | `bg-yellow-500/15` | `text-yellow-600`       |
| `error`   | `bg-red-500/15`    | `text-red-600`          |

### StatCard

A metric card for dashboards. Label + large value + optional delta.

| Prop    | Type     | Required | Description                               |
| ------- | -------- | -------- | ----------------------------------------- |
| `label` | `string` | yes      | Small descriptor above the value          |
| `value` | `string` | yes      | The primary metric — displayed large      |
| `delta` | `string` | no       | Trend vs previous period — rendered green |

```tsx
<StatCard label="Total Students" value="1,284" delta="+12% this week" />
<StatCard label="Courses" value="48" />
```

### CodeTag

Inline monospace code for prose or labels.

```tsx
<CodeTag>pnpm install</CodeTag>
<CodeTag>git commit -m "feat"</CodeTag>
```

Renders as `<code>` with `bg-muted`, small padding, `font-mono`. For longer code blocks, use the notebook cell editor.

---

## runInWorker (utility, not a component)

**File:** `src/features/notebook/runtime/workerHost.ts`
**Import:** `import { runInWorker } from '@/features/notebook'`

Pure async function that runs a JavaScript string inside the sandboxed
Web Worker + QuickJS kernel and returns structured output. Not a React
component.

```ts
const result = await runInWorker(`console.log(2 + 2)`)
// result.status: 'done'
// result.items: [{ type: 'stdout', text: '4' }]
```

| Return field | Type            | Description                                                                    |
| ------------ | --------------- | ------------------------------------------------------------------------------ |
| `status`     | `RuntimeStatus` | `'done' \| 'error' \| 'timeout' \| 'interrupted'`                              |
| `items`      | `OutputItem[]`  | Structured output: `stdout` / `stderr` / `result` / `error` / `html` / `image` |

Shared scope (variables, functions, classes) lives inside the persistent
worker VM and carries across runs automatically; nothing is passed in or
out per call. See [How the Notebook Works](../notebook/how-it-works.md)
for the full execution flow.
