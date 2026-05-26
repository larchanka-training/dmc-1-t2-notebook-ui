# How the Notebook Works

## Overview

Each code cell runs in an **isolated QuickJS VM** that lives inside a
dedicated **Web Worker**. Two layers of isolation, one path of data:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Main thread (React + Reatom)                                       │
│  ┌─────────────┐    Run/Stop/Restart    ┌────────────────────────┐  │
│  │ NotebookView│ ─────────────────────▶ │ model/runtime.ts       │  │
│  │ + Toolbar   │                        │ runtimeStatusAtom      │  │
│  └─────────────┘                        │ execCounterAtom        │  │
│        ▲  OutputItem[]                  │ queueAtom              │  │
│        │                                └─────────┬──────────────┘  │
│        │                                          │ runInWorker     │
│  ┌─────┴───────┐                                  ▼                 │
│  │ OutputView  │                       ┌────────────────────────┐   │
│  │ NotebookCell│                       │ runtime/workerHost.ts  │   │
│  └─────────────┘                       │ singleton + queue      │   │
│                                        └───────┬────────────────┘   │
└────────────────────────────────────────────────│────────────────────┘
                                                 │ postMessage
                                                 │
┌────────────────────────────────────────────────│────────────────────┐
│  Worker thread (runtime/worker.ts)             ▼                    │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ runtime/transform.ts                                        │   │
│   │ acorn → prelude + lift declarations + return trailing expr  │   │
│   └─────────────────┬───────────────────────────────────────────┘   │
│                     ▼                                               │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │ runtime/quickjs.ts                                          │   │
│   │ QuickJS context · console.log injected · deadline interrupt │   │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

The user's code never touches the page — no `window`, no `document`, no
`fetch`, no `localStorage`, no `IndexedDB`, no `crypto`. Even DOM-less
browser APIs (`self`, `importScripts`) live in the worker, not in
QuickJS, so the VM still cannot reach them.

---

## Execution pipeline

```
NotebookCell (Run clicked)
    │
    ▼
model/runtime.ts: runCell(id)
    │  cell.status = 'running'
    │  executionCount = ++execCounterAtom
    │  cell.output = []
    │
    ▼
runtime/workerHost.ts: runInWorker(code, scope, { timeoutMs })
    │  serialise after any pending run
    │  worker = ensureWorker()
    │
    ▼
postMessage({ kind: 'run', runId, code, scope, timeoutMs })
    │
    ▼ (inside Worker)
runtime/worker.ts: self.onmessage
    │
    ▼
runtime/transform.ts: rewrite top-level declarations to write through
                       globalThis.__ctx; trailing ExpressionStatement
                       becomes `return <expr>`
    │
    ▼
runtime/quickjs.ts: runInQuickJS(transformedCode, scope, { timeoutMs })
    │  inject console.log / info / warn / error
    │  setInterruptHandler(deadline)
    │  install scope on globalThis.__ctx
    │  evalCode(`(async () => { ... })()`)
    │  await vm.resolvePromise
    │  collect OutputItem[] · extract updated scope
    │
    ▼
postMessage({ kind: 'output', item }) × N
postMessage({ kind: 'done', status, scope })
    │
    ▼ (back on main thread)
workerHost resolves with { status, items, scope }
    │
    ▼
runtime.ts: cell.output = items
           sharedScopeAtom = scope
           cell.status = mapStatus(...)
           runtimeStatusAtom = 'idle'
```

---

## OutputItem model

`cell.output()` is an array of **structured items**, not a string. Each
item has its own renderer in `OutputView`:

```ts
type OutputItem =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string } // also: console.warn → '[warn] …'
  | { type: 'result'; value: SerializedValue }
  | { type: 'error'; name: string; message: string; stack?: string }
```

`SerializedValue` is recursion-safe up to depth 5; anything deeper, or a
cyclic reference, becomes `{ kind: 'truncated', placeholder: '[Object]' }`.

---

## Shared scope (Jupyter-style)

Top-level `var` / `let` / `const` / `function` declarations from cell N
are visible in cell N+1. Mechanism:

1. `runtime/transform.ts` walks the cell's AST.
2. Every top-level declaration emits a follow-up
   `globalThis.__ctx.<name> = <name>`, so QuickJS holds the value in a
   single shared object.
3. Every subsequent run starts with a `prelude` that binds incoming keys
   back as locals: `const x = globalThis.__ctx.x`.
4. `sharedScopeAtom` carries the structured-clone-safe slice of `__ctx`
   between cells (functions are dropped at the worker boundary — they
   only live for a single run).

**Restart Kernel** clears `sharedScopeAtom`, `execCounterAtom`,
`queueAtom`, and every cell's `executionCount` / `status` / `output`.

**Deleting a cell does NOT remove its variables.** Jupyter semantics:
once a binding made it into the kernel, it stays until Restart.

---

## Stop and timeout

Two independent mechanisms cooperate:

1. **In-VM interrupt.** `setInterruptHandler` polls a deadline and
   aborts the QuickJS bytecode loop. This catches `while(true){}` even
   though the VM has no `await` point.
2. **Host-side terminate.** The host runs a `setTimeout(timeoutMs + 100)`
   and a `worker.terminate()` callback. This is the last resort —
   relevant if the VM ever blocks on a native call.

`stopCell` and `stopAll` short-circuit both: they call `restartWorker()`,
which terminates the current worker and unsticks the in-flight run via
`inFlightResolver`. A fresh worker is spun up on the next call.

The user-visible cell status of an interrupted cell is `'interrupted'`,
with an explicit stderr item in the output. Host-side timeouts surface
as `'timeout'`.

---

## Limits

| Limit          | Default                 | Configurable via                             |
| -------------- | ----------------------- | -------------------------------------------- |
| Execution time | 30 s                    | `runInWorker(code, scope, { timeoutMs })`    |
| Output size    | 5 MB cumulative per run | `runtime/workerHost.ts: OUTPUT_BUDGET_BYTES` |

When the output budget is exceeded, the host appends `{ type: 'stderr',
text: 'Output truncated at <N> bytes' }`, terminates the worker, and
resolves the run as `error`. Further output messages from the worker
are discarded.

---

## Cell state machine

```
idle ──(runCell)──▶ running ──(success)─▶ done
                      │
                      ├──(error)────────▶ error
                      ├──(timeout)──────▶ error      // worker hit host budget
                      └──(stopCell)─────▶ interrupted
```

`runAll` puts every code cell in the queue. The first non-`done` status
short-circuits the rest as `skipped`.

| Status        | Border / Lead-bar          | Run button | Output      |
| ------------- | -------------------------- | ---------- | ----------- |
| `idle`        | default                    | green play | hidden      |
| `running`     | primary lead-bar           | red stop   | partial     |
| `done`        | default                    | green play | visible     |
| `error`       | red (`border-destructive`) | green play | red         |
| `interrupted` | default                    | green play | stderr note |
| `skipped`     | default                    | green play | empty       |

---

## ExecutionCount badge

Each cell shows `[N]` in its header — the **execution counter** value
at the time of its last run. Editing the code does **not** change it.
Only Restart Kernel resets the counter. A cell that never ran shows
`[ ]`.

---

## Related files

| File                                           | Layer                                                       |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `src/features/notebook/runtime/types.ts`       | Worker protocol + OutputItem + SerializedValue              |
| `src/features/notebook/runtime/serialize.ts`   | Safe walk to depth 5, cycle-safe                            |
| `src/features/notebook/runtime/transform.ts`   | acorn AST: prelude + lift + trailing return                 |
| `src/features/notebook/runtime/quickjs.ts`     | QuickJS VM, console, interrupt, async IIFE                  |
| `src/features/notebook/runtime/worker.ts`      | Worker entrypoint                                           |
| `src/features/notebook/runtime/workerHost.ts`  | Main-thread facade, timeout, output budget                  |
| `src/features/notebook/model/notebook.ts`      | `cellsAtom`, CRUD, `sharedScopeAtom`                        |
| `src/features/notebook/model/runtime.ts`       | `runCell`, `runAll`, `stopCell`, `stopAll`, `restartKernel` |
| `src/features/notebook/domain/cell.ts`         | `reatomCell()` factory, atomized fields                     |
| `src/features/notebook/ui/OutputView.tsx`      | Renders `OutputItem[]`                                      |
| `src/features/notebook/ui/NotebookToolbar.tsx` | Run All / Stop All / Restart                                |
| `src/features/notebook/ui/NotebookCell.tsx`    | Per-cell UI with Stop button                                |
