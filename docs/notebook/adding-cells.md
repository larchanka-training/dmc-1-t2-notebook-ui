# Working with Cells

## Adding a cell

**From the toolbar** — click **+ Add Cell** in the top bar. The new cell is added at the bottom.

**From the bottom of the list** — click the ghost **+ Add cell** button below the last cell.

Programmatically, cells are added via `addCell(afterId?)`:

```ts
// adds at the end
addCell()

// inserts immediately after the cell with this id
addCell(cell.id)
```

---

## Running a cell

Three ways:

| Method | Action |
|---|---|
| Keyboard | `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows/Linux) |
| Mouse | Hover the cell → click the green **▶** play button |

Both call `runCell(id)` which delegates to `executeJS`. See [How It Works](./how-it-works.md) for the full execution flow.

---

## Moving cells

Hover any cell to reveal the **↑ ↓** buttons in the cell header. These swap the cell with its neighbour in the `cells` array.

- The **↑** button is disabled on the first cell
- The **↓** button is disabled on the last cell

---

## Deleting a cell

Hover the cell → click the **🗑** (trash) icon. The minimum cell count is **1** — deleting the last remaining cell is a no-op.

---

## Cell state is local

Cells are stored in React state in `NotebookPage`. This means:

- **Refreshing the page clears all cells** — there is no persistence yet
- **Cells are independent** — running cell 3 does not re-run cells 1 and 2
- Variables defined in one cell are **not** available in another (each cell runs in its own `new Function` scope)

### Sharing data between cells

Since cells don't share scope, use `window` to pass values:

```js
// Cell 1
window.myData = [1, 2, 3, 4, 5]
```

```js
// Cell 2
console.log(window.myData.map(n => n * 2))
// output: 2,4,6,8,10
```

---

## The NotebookCell component

Each cell in the list renders a `<NotebookCell />` component. The page passes all state and callbacks as props — the component itself is stateless:

```tsx
<NotebookCell
  index={idx + 1}
  code={cell.code}
  output={cell.output}
  status={cell.status}
  isFirst={idx === 0}
  isLast={idx === cells.length - 1}
  onCodeChange={code => updateCell(cell.id, { code })}
  onRun={() => runCell(cell.id)}
  onDelete={() => deleteCell(cell.id)}
  onMoveUp={() => moveCell(cell.id, -1)}
  onMoveDown={() => moveCell(cell.id, 1)}
/>
```

See the [Custom Components](../components/custom.md#notebookcell) doc for the full `NotebookCell` props reference.

---

## Extending the notebook

Ideas for future additions:

| Feature | Approach |
|---|---|
| **Persist cells** | Save `cells` array to `localStorage` on every change |
| **Markdown cells** | Add `type: 'code' \| 'markdown'` to the `Cell` type, render with a markdown parser |
| **Shared scope between cells** | Execute all previous cells in sequence before the current one |
| **Cell output formatting** | Detect arrays/objects and pretty-print with JSON syntax highlighting |
| **Export notebook** | Serialize `cells` to JSON and trigger a file download |
