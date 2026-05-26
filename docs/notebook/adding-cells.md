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

| Method   | Action                                               |
| -------- | ---------------------------------------------------- |
| Keyboard | `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows/Linux)    |
| Mouse    | Click the green **▶** play button in the cell header |

Both call the `runCell(id)` action, which runs the code in the sandboxed Web Worker + QuickJS kernel via `runInWorker`. See [How It Works](./how-it-works.md) for the full execution flow.

---

## Moving cells

The **↑ ↓** buttons in each cell header swap the cell with its neighbour via the `moveCell(id, dir)` action.

- The **↑** button is disabled on the first cell
- The **↓** button is disabled on the last cell

---

## Deleting a cell

Click the **🗑** (trash) icon to call `deleteCell(id)`. The minimum cell count is **1** — deleting the last remaining cell is a no-op.

---

## Cell state

Cells live in `cellsAtom`, an in-memory Reatom atom. Each cell's editable fields are themselves atoms (atomization pattern):

```ts
// src/features/notebook/domain/cell.ts
interface Cell {
  id: string
  code: Atom<string>
  output: Atom<string>
  status: Atom<'idle' | 'running' | 'done' | 'error'>
}
```

This means:

- **Refreshing the page clears all cells** — there is no persistence yet (no `withLocalStorage`).
- **Cells are independent** — running cell 3 does not re-run cells 1 and 2.
- **Variables defined in one cell are not available in another** — each `runCell` invocation wraps code in a fresh `new Function(...)` scope.
- **Updating one field on one cell does not re-render others** — atomized fields produce focused updates (see [Atomization](../../.claude/skills/reatom/SKILL.md#atomization) in the Reatom skill).

### Sharing data between cells

Since cells don't share lexical scope, use `window` (or `globalThis`) to pass values:

```js
// Cell 1
window.myData = [1, 2, 3, 4, 5]
```

```js
// Cell 2
console.log(window.myData.map((n) => n * 2))
// output: 2,4,6,8,10
```

---

## The NotebookCell component

Each cell renders a `<NotebookCell />`. The component is **stateless** — the parent (`NotebookView`) reads each atom's value and passes plain values + wrapped callbacks as props:

```tsx
import { wrap } from '@reatom/core'
import { NotebookCell } from '@/features/notebook'
import { updateCellCode, runCell, deleteCell, moveCell } from '@/features/notebook'
;<NotebookCell
  index={idx + 1}
  code={cell.code()}
  output={cell.output()}
  status={cell.status()}
  isFirst={idx === 0}
  isLast={idx === cells.length - 1}
  onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
  onRun={wrap(() => runCell(cell.id))}
  onDelete={wrap(() => deleteCell(cell.id))}
  onMoveUp={wrap(() => moveCell(cell.id, -1))}
  onMoveDown={wrap(() => moveCell(cell.id, 1))}
/>
```

See [Custom Components — NotebookCell](../components/custom.md#notebookcell) for the full props reference.

---

## Extending the notebook

Ideas for future additions:

| Feature                        | Approach                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| **Persist cells**              | Extend `cellsAtom` with `withLocalStorage` (or serialise atomized fields manually)       |
| **Markdown cells**             | Add `type: 'code' \| 'markdown'` to the `Cell` type, render with a markdown parser       |
| **Shared scope between cells** | Execute prior cells' code in sequence inside one `Function` scope before the current one |
| **Cell output formatting**     | Detect arrays/objects and pretty-print with JSON syntax highlighting                     |
| **Export notebook**            | Serialise `cellsAtom()` to JSON and trigger a file download                              |
