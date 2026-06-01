# Working with Cells

Cells are stored in a Reatom atom (`cellsAtom`) in `src/features/notebook/model/notebook.ts`. The notebook view subscribes via `reatomComponent` — there is **no `useState`**.

---

## Adding a cell

**From the toolbar** — click **+ Add Cell** in the top bar. The new cell is added at the bottom.

**From the bottom of the list** — click the ghost **+ Add cell** button below the last cell.

Programmatically, cells are added via the `addCell(afterId?)` Reatom action:

```ts
import { addCell } from '@/features/notebook'

addCell() // adds at the end
addCell(cell.id) // inserts immediately after the cell with this id
```

Both buttons call `addCell()` wrapped in `wrap(...)` so they preserve Reatom's async context (see [reatom.md](../architecture/reatom.md)).

---

## Running a cell

| Method   | Action                                                      |
| -------- | ----------------------------------------------------------- |
| Keyboard | `Cmd/Ctrl+Enter` — run, stay on the cell                    |
| Keyboard | `Shift+Enter` — run, then move to (or create) the next cell |
| Keyboard | `Alt+Enter` — run, then insert a fresh code cell below      |
| Mouse    | Click the green **▶** play button in the cell header        |

All call the `runCell(id)` action, which runs the code in the sandboxed Web Worker + QuickJS kernel via `runInWorker`. The `Shift/Alt+Enter` variants additionally drive cell focus/creation. See [How It Works](./how-it-works.md) for the full execution flow and the [keyboard shortcuts](#keyboard-shortcuts) section for the complete list.

---

## Moving cells

Three ways to reorder:

- **↑ ↓** buttons in the cell menu swap with the neighbour via `moveCell(id, dir)`. **↑** is disabled on the first cell, **↓** on the last.
- **Drag-and-drop** — grab the `⋮⋮` handle on the left gutter and drop the cell at an absolute position via `moveCellTo(id, index)`. Drop zones highlight between cells; `Esc` mid-drag cancels; the page auto-scrolls near the viewport edge. Keyboard drag is supported for accessibility (focus the handle, `Space` to lift, arrows to move, `Space` to drop).

---

## Deleting a cell

Click the **🗑** (trash) icon, or press `D D` (two quick presses) in command mode — both call `deleteCell(id)`. The minimum cell count is **1** — deleting the last remaining cell is a no-op. A delete is undoable with `Cmd/Ctrl+Z` (see [Undo / redo](#undo--redo)).

---

## Cell state

Cells live in `cellsAtom`, an in-memory Reatom atom. Each cell's editable fields are themselves atoms (atomization pattern):

```ts
// src/features/notebook/domain/cell.ts
interface Cell {
  id: string
  kind: 'code' | 'markdown'
  code: Atom<string>
  output: Atom<OutputItem[]>
  status: Atom<'idle' | 'running' | 'done' | 'error' | 'interrupted' | 'timeout' | 'skipped'>
  viewMode: Atom<'edit' | 'preview'>
  executionCount: Atom<number | null>
}
```

This means:

- **Refreshing the page clears all cells** — there is no persistence yet (no `withLocalStorage`).
- **Cells share scope** — a variable declared in cell N is visible in cell N+1 (Jupyter-style). The code runs inside a persistent QuickJS VM in a Web Worker, not on the main thread — see [How it works — Shared scope](./how-it-works.md#shared-scope-jupyter-style).
- **Output is structured** — `output` is an `OutputItem[]` (stdout / stderr / result / error / html / image), not a flat string. `executionCount` drives the `[N]` badge and is reset only by Restart Kernel.
- **Updating one field on one cell does not re-render others** — atomized fields produce focused updates (see [Atomization](../../.claude/skills/reatom/SKILL.md#atomization) in the Reatom skill).

### Sharing data between cells

Declare a value in one cell and read it in the next — top-level `var` / `let` / `const` / `function` / `class` declarations are shared through the kernel's persistent scope:

```js
// Cell 1
const myData = [1, 2, 3, 4, 5]
```

```js
// Cell 2
console.log(myData.map((n) => n * 2))
// output: 2,4,6,8,10
```

> `window` / `globalThis` are **not** a sharing channel: the sandbox has no
> `window`, and host globals are unreachable from user code by design.
> `Restart Kernel` clears the shared scope; deleting a cell does **not**.

---

## The NotebookCell component

Each cell renders a `<NotebookCell />`. The component is **stateless** — the parent (`NotebookView`) reads each atom's value and passes plain values + wrapped callbacks as props:

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
  theme={resolvedThemeAtom()}
  showLineNumbers={lineNumbersAtom()}
  active={isActive}
  mode={mode}
  autoFocus={isActive && mode === 'edit'}
  isFirst={idx === 0}
  isLast={idx === cells.length - 1}
  onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
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

Code cells render a **CodeMirror 6** editor (`CodeEditor`); markdown cells render
a textarea with a preview toggle. Both honour the modal `mode` (`command` /
`edit`) and the `active` focus indicator.

See [Custom Components — NotebookCell](../components/custom.md#notebookcell) for the full props reference.

---

## Keyboard shortcuts

The notebook is modal (Jupyter-style): a focused cell is either in **edit** mode
(caret in the editor, green left bar) or **command** mode (cell shell focused,
blue left bar). Press `?` any time to open the in-app cheat-sheet.

**Edit mode (in the editor)**

| Keys             | Action                            |
| ---------------- | --------------------------------- |
| `Shift+Enter`    | Run, go to / create the next cell |
| `Cmd/Ctrl+Enter` | Run, stay                         |
| `Alt+Enter`      | Run, insert a code cell below     |
| `Cmd/Ctrl+E`     | Markdown: toggle edit / preview   |
| `Esc`            | Leave the editor for command mode |

**Command mode (cell focused)**

| Keys      | Action                         |
| --------- | ------------------------------ |
| `A` / `B` | Insert a cell above / below    |
| `D D`     | Delete the cell (undoable)     |
| `M` / `Y` | Change kind to markdown / code |
| `↑` / `↓` | Move focus between cells       |
| `Enter`   | Enter edit mode                |

**Global**

| Keys                              | Action                          |
| --------------------------------- | ------------------------------- |
| `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` | Undo / redo notebook operations |
| `Cmd/Ctrl+F`                      | Search the notebook             |
| `?`                               | Show this shortcut list         |

Shortcut handling lives in `shared/lib/hotkeys.ts` (a document-level scope
stack); the editor's own `Enter`/`Esc`/run keys are bound inside CodeMirror at
`Prec.highest`.

---

## Undo / redo

Notebook operations — add, delete, move, change-kind, and source edits — are
recorded in an in-memory history stack (`model/history.ts`, last 50 entries).
`Cmd/Ctrl+Z` undoes, `Cmd/Ctrl+Shift+Z` redoes; source edits coalesce per cell
within a 1s window so a burst of typing is one undo step. Running a cell
(`output` / `executionCount`) is **not** recorded. The stack is in-memory and
clears on reload (no persistence yet). CodeMirror does **not** keep its own undo
history — the notebook stack is the single owner of `Cmd/Ctrl+Z`, so one press
is always one notebook-level step even while typing in a code cell.

---

## Extending the notebook

Ideas for future additions:

| Feature                    | Approach                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------- |
| **Persist cells**          | Extend `cellsAtom` with `withLocalStorage` (or serialise atomized fields manually) |
| **Cell output formatting** | Richer inspector for `result` items (collapsible trees, syntax highlighting)       |
| **Export notebook**        | Serialise `cellsAtom()` to JSON and trigger a file download                        |

> Markdown cells and shared scope between cells are already implemented — see
> `kind: 'markdown'` and [How it works](./how-it-works.md).
