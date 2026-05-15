# Reatom conventions

This project uses [Reatom](https://v1001.reatom.dev) (`@reatom/core` + `@reatom/react`) for state, async data, and orchestration. Most of the framework's general rules live in the Reatom skill / official docs; this page only documents what is **specific to this repository**.

---

## `clearStack()` is enabled

`src/setup.ts` calls `clearStack()` before anything else:

```ts
// src/setup.ts
import { clearStack, context } from '@reatom/core'

// Don't dare to remove this line!
clearStack()

export const rootFrame = context.start()
```

`clearStack()` disables Reatom's implicit fallback to the global context. The consequence: **every async or event boundary that touches an atom or action must explicitly inherit context via `wrap`** — otherwise Reatom throws:

```
Uncaught ReatomError: missing async stack
```

This is intentional. It surfaces missing `wrap` calls immediately instead of letting them produce subtle context-loss bugs in production.

---

## React event handlers are async boundaries

React's `onClick`, `onChange`, `onSubmit`, `onKeyDown`, etc. fire **after** the render frame, outside any Reatom context. They are the same kind of boundary as `addEventListener` — treat them identically.

### Bad

```tsx
<Button onClick={() => addCell()} />
<input onChange={(e) => updateCellCode(id, e.target.value)} />
```

These will throw `ReatomError: missing async stack` the moment the handler tries to update an atom.

### Good

```tsx
import { wrap } from '@reatom/core'

<Button onClick={wrap(() => addCell())} />
<input onChange={wrap((e: ChangeEvent<HTMLInputElement>) => updateCellCode(id, e.target.value))} />
```

`wrap` captures the current render-time Reatom context and binds it to the returned function, so when the handler fires later, atoms and actions see the context they need.

### Callbacks passed as props

The same rule applies to callbacks passed down to a child component that ultimately wires them to a DOM event. Wrap at the point where the closure over the action is created — inside the `reatomComponent` body, where the render-time context exists to capture.

```tsx
// inside a reatomComponent
<NotebookCell
  onDelete={wrap(() => deleteCell(cell.id))}
  onMoveUp={wrap(() => moveCell(cell.id, -1))}
/>
```

Not inside the presentational `NotebookCell` itself — by the time the handler reaches the DOM, the original context is gone.

---

## Debugging `missing async stack`

If you see `ReatomError: missing async stack` in the console, the stack trace will point at the action and the JSX handler that called it. The fix is **always** `wrap` at that handler — don't go digging in the action implementation. Example trace:

```
Uncaught ReatomError: missing async stack
    at top (index.js:1188)
    at notebook.cells.add (index.js:997)
    at onClick (NotebookView.tsx:66)
```

The fix is at `NotebookView.tsx:66`, not in `notebook.cells.add`.

---

## See also

- Reatom official docs: <https://v1001.reatom.dev>
- `src/setup.ts` — the `clearStack()` call
- `src/features/notebook/ui/NotebookView.tsx` — example of `wrap` on React handlers
