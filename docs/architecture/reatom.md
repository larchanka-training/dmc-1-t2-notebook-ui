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

## Lazy resources: reading data is a subscription (and can fetch)

Async reads in this repo use `computed(async () => wrap(api...())).extend(withAsyncData())`. This is the recommended Reatom way: it gives `.data()`, `.ready()`, `.error()`, `.status()`, `.retry()`, and race-cancellation (`withAbort`) for free. `notebookListResource` (the sidebar notebook list) and `demoPresenceResource` (the Usage restore detector) are the two in the codebase.

The one thing to internalise: a `computed` is LAZY. Its body runs only while it has a subscriber, and reading its value IS subscribing. So `notebookListResource.data()` in a component is not a passive cache peek: it connects the resource, which makes it "hot", which runs the body, which fires `GET /notebooks`. Reading data can perform a network request. This is the same model as TanStack Query's `useQuery`, not Pinia's `storeToRefs`.

That implicit link ("read `data()` = go to the network") is where every list-fetch bug in this repo came from. The rules below keep it from biting again.

### G1. Auth-gate BEFORE reading a protected resource

In any component or `computed` that reads `notebookListResource.data()` (or any protected resource), put the `userAtom()` / `authStatusAtom` check ABOVE the first `data()` read. Return early for a guest before touching the resource. Otherwise the read heats the resource and fires the request without a token (a 401 on a public route).

```ts
// bad: the read heats the resource before the guest is turned away
notebookListResource.data()
if (!userAtom()) return

// good: the guest is turned away before the resource is touched
if (!userAtom()) return
notebookListResource.data()
```

This is why `AppSidebar`'s `NotebooksGroup` returns `null` on `!user` BEFORE reading the list, and why `UsagePage`'s `demoPresenceResource` checks the user first.

### G2. One source of the fetch per resource

Let the resource's own lazy subscription be the single fetcher. The sidebar reading `data()` after sign-in IS that single source; it loads once on its own. Do not add an extra manual `notebookListResource.retry()` on top of a path where the subscription already fetches (that produces the double `GET /notebooks` after login). The explicit `retry()` in `startNotebookListSync` is scoped to a true account SWITCH (A to B, no null between), where the sidebar never unmounts and the hot resource would otherwise keep the previous account's rows. `reconcileBootFromServer` does a separate direct `notebookApi.list()` on the boot/fresh-device path; that is a known, documented second source (see `remote-sync.md`).

### G3. For a side-effect on change, use a hook, not a read

To react to a resource's data changing WITHOUT subscribing (e.g. the cross-tab writer), use `addChangeHook` / `withChangeHook`, not `data()`. To read the current value outside a reactive context, use `peek(...)`: it reads the cache and does NOT recompute the `computed`, so it never triggers a fetch. `notebookListCrossTab.ts` does exactly this.

### G4-G6. The defaults

- G4: new async READS go through `computed + withAsyncData`. Do not hand-roll a `fetch` in an `effect` or at component mount, and do not add a manual `AbortController` (it is already inside `withAsyncData`).
- G5: new async MUTATIONS go through `action(...).extend(withAsync())`; add `withTransaction()` + `withRollback()` for optimistic edits (as create/delete do).
- G6: declare `atom` / `computed` / `action` at MODULE level (singletons), never inside a component body (that mints a new instance per render). Local UI-only state stays in `useState`.

---

## See also

- Reatom official docs: <https://v1001.reatom.dev>
- Reatom skill: `ui/.agents/skills/reatom/SKILL.md` (load it for any state / async / routing / forms work, reading included)
- `src/setup.ts` — the `clearStack()` call
- `src/features/notebook/ui/NotebookView.tsx` — example of `wrap` on React handlers
