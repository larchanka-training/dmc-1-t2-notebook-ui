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

The presentational building block of the notebook. Code cells render a **CodeMirror 6** editor (themed from the app's `resolvedThemeAtom`); markdown cells render a sans-serif textarea with an edit/preview toggle, and code cells show an output area below. The component is fully **stateless** — its parent (`NotebookView`) manages all state via Reatom and passes plain values and callbacks as props.

### Props

| Prop                  | Type                                                                                  | Required | Description                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `executionCount`      | `number \| null`                                                                      | no       | Run counter shown as `[n]`; `null` (the default) renders `[ ]`                                      |
| `kind`                | `'code' \| 'markdown'`                                                                | no       | Cell type; `markdown` swaps the run button for a text label                                         |
| `code`                | `string`                                                                              | yes      | Cell source: code (CodeMirror) or markdown (textarea)                                               |
| `output`              | `OutputItem[]`                                                                        | no       | Structured output items (stdout / stderr / result / error / html / image) rendered below code cells |
| `status`              | `'idle' \| 'running' \| 'done' \| 'error' \| 'interrupted' \| 'timeout' \| 'skipped'` | no       | Controls border colour and run/stop button                                                          |
| `viewMode`            | `'edit' \| 'preview'`                                                                 | no       | Markdown cells only: edit vs rendered preview                                                       |
| `theme`               | `'light' \| 'dark'`                                                                   | no       | Drives the CodeMirror syntax palette; follows the app's `resolvedThemeAtom`                         |
| `showLineNumbers`     | `boolean`                                                                             | no       | Show the CodeMirror line-number gutter (code cells)                                                 |
| `autoFocus`           | `boolean`                                                                             | no       | Pull focus into the editor (cell is active in edit mode)                                            |
| `active`              | `boolean`                                                                             | no       | Whether this cell holds focus; drives the left focus bar                                            |
| `mode`                | `'edit' \| 'command'`                                                                 | no       | Modal state of the active cell; bar is green in edit, blue in command                               |
| `isFirst`             | `boolean`                                                                             | no       | Disables the move-up button                                                                         |
| `isLast`              | `boolean`                                                                             | no       | Disables the move-down button                                                                       |
| `readOnly`            | `boolean`                                                                             | no       | Prevents editing the cell                                                                           |
| `cellId`              | `string`                                                                              | no       | Cell id; used by the code editor to pull its notebook-search matches                                |
| `onCodeChange`        | `(code: string) => void`                                                              | no       | Called on every keystroke                                                                           |
| `onViewModeChange`    | `(mode: CellViewMode) => void`                                                        | no       | Markdown cells only: toggles edit/preview                                                           |
| `onFocus`             | `() => void`                                                                          | no       | Editor gained focus → enter edit mode                                                               |
| `onRun`               | `() => void`                                                                          | no       | Run, stay on the cell (play button or `Cmd/Ctrl+Enter`)                                             |
| `onRunAndAdvance`     | `() => void`                                                                          | no       | `Shift+Enter`: run, then move to (or create) the next cell                                          |
| `onRunAndInsertBelow` | `() => void`                                                                          | no       | `Alt+Enter`: run, then insert a fresh code cell below                                               |
| `onExitToCommand`     | `() => void`                                                                          | no       | `Esc`: leave the editor for command mode                                                            |
| `onStop`              | `() => void`                                                                          | no       | Called when the stop button is pressed while the cell is `running`                                  |
| `onDelete`            | `() => void`                                                                          | no       | Called when the trash icon is clicked                                                               |
| `onMoveUp`            | `() => void`                                                                          | no       | Called when the ↑ menu item is clicked                                                              |
| `onMoveDown`          | `() => void`                                                                          | no       | Called when the ↓ menu item is clicked                                                              |

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
import { resolvedThemeAtom } from '@/entities/theme'
import {
  NotebookCell,
  updateCellCode,
  runCell,
  stopCell,
  deleteCell,
  moveCell,
  lineNumbersAtom,
  enterEdit,
  enterCommand,
} from '@/features/notebook'
// `isActive` / `mode` come from the cellMode atoms; `runAndAdvance` and
// `runAndInsertBelow` are NotebookView-local helpers (run + focus / insert).
;<NotebookCell
  executionCount={cell.executionCount()}
  kind={cell.kind}
  code={cell.code()}
  output={cell.output()}
  status={cell.status()}
  viewMode={cell.viewMode()}
  theme={resolvedThemeAtom()}
  showLineNumbers={lineNumbersAtom()}
  active={isActive}
  mode={mode}
  autoFocus={isActive && mode === 'edit'}
  cellId={cell.id}
  isFirst={idx === 0}
  isLast={idx === cells.length - 1}
  onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
  onViewModeChange={wrap((next: CellViewMode) => cell.viewMode.set(next))}
  onFocus={wrap(() => enterEdit(cell.id))}
  onRun={wrap(() => runCell(cell.id))}
  onRunAndAdvance={wrap(() => runAndAdvance(cell.id))}
  onRunAndInsertBelow={wrap(() => runAndInsertBelow(cell.id))}
  onExitToCommand={wrap(() => enterCommand())}
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

- Code cells render a **CodeMirror 6** editor; markdown cells use a sans-serif `<textarea>` with a preview toggle. Code cells no longer use a `<textarea>`.
- The CodeMirror syntax palette follows the app theme via a `Compartment` — the one-dark palette in dark, the default highlight style in light — using design tokens, not hard-coded colours (see `codemirror/theme.ts`).
- The markdown textarea auto-resizes to fit content using `scrollHeight`; the CodeMirror editor manages its own height.
- The cell-options menu (move / delete) is hover-gated (`opacity-0 group-hover/cell`), not always visible.

---

## NotebookView

**File:** `src/features/notebook/ui/NotebookView.tsx`
**Import:** `import { NotebookView } from '@/features/notebook'`
**Used in:** `NotebookPage`

The container that reads `cellsAtom`, renders the list of `NotebookCell`s, and exposes "Add Cell" buttons. This is where Reatom actions (`addCell`, `runCell`, `deleteCell`, `moveCell`/`moveCellTo`, `updateCellCode`, the `cellMode` actions) get wired into DOM event handlers via `wrap`. It also hosts the drag-and-drop context (`@dnd-kit`), the notebook `SearchBar`, and the command-mode / undo-redo hotkeys.

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
