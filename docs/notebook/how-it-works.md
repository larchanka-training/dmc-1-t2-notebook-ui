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
runtime/workerHost.ts: runInWorker(code, { timeoutMs })
    │  serialise after any pending run
    │  worker = ensureWorker()
    │
    ▼
postMessage({ kind: 'run', runId, code, timeoutMs })
    │
    ▼ (inside Worker, one persistent kernel for its whole lifetime)
runtime/worker.ts: self.onmessage
    │
    ▼
runtime/transform.ts: publish top-level declarations to globalThis;
                       trailing ExpressionStatement becomes `return <expr>`
    │
    ▼
runtime/quickjs.ts: kernel.run(transformedCode, { timeoutMs })
    │  console + display already installed on the persistent VM
    │  setInterruptHandler(deadline OR SharedArrayBuffer stop flag)
    │  evalCode(`(async () => { ... })()`)  — scope lives in the VM
    │  await vm.resolvePromise
    │  collect OutputItem[]
    │
    ▼
postMessage({ kind: 'output', item }) × N
postMessage({ kind: 'done', status })
    │
    ▼ (back on main thread)
workerHost resolves with { status, items }
    │
    ▼
runtime.ts: cell.output = items
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
  | { type: 'html'; html: string } // → sandboxed iframe
  | { type: 'image'; mime: string; data: string } // base64 → <img>
```

`SerializedValue` is recursion-safe up to depth 5; anything deeper, or a
cyclic reference, becomes `{ kind: 'truncated', placeholder: '[Object]' }`.

### Rich output: `display()`

Inside the sandbox the user calls an explicit Jupyter-style function:

```js
display({ type: 'html', value: '<b>hi</b>' })
display({ type: 'image', mime: 'image/png', data: '<base64>' })
```

HTML items render in an `<iframe sandbox="allow-scripts">` with a unique
origin (no `allow-same-origin`), so scripts inside cannot read parent
cookies, storage or DOM. The iframe reports its content height back via
`postMessage` so we can auto-resize up to a 600 px cap; anything taller
scrolls inside the frame. Image items render as
`<img src="data:<mime>;base64,<data>">`. There is no magic
auto-promotion of strings or `<svg>` tags — a rich output appears only
when the user explicitly calls `display()`.

---

## Shared scope (Jupyter-style)

The worker holds **one persistent QuickJS VM** for its whole lifetime, so
shared scope is just that VM's own global state. Top-level
`var` / `let` / `const` / `function` / `class` declarations — including
closures and live class instances — from cell N are visible in cell N+1.
Mechanism:

1. `runtime/transform.ts` walks the cell's AST.
2. Each cell runs inside a fresh async IIFE (so top-level `await` works).
   Every top-level declaration is **rewritten into a plain assignment to a
   `globalThis` slot**, dropping the declaration keyword entirely — there
   is NO local lexical binding left behind:
   - `const x = e` / `let x = e` / `var x = e` → `;(globalThis.x = (e));`
   - destructuring → the binding pattern becomes an assignment pattern whose
     targets are `globalThis.<name>` members;
   - `function f(){}` / `class C {}` → `globalThis.f = function f(){}` /
     `globalThis.C = class C {}` (the named expression keeps self-recursion).
3. A later cell reads a bare identifier (`x`), which the VM resolves to
   `globalThis.x`. There is no prelude and no `__ctx` snapshot — the
   value lives in the VM, never crossing the postMessage boundary.
4. Because there is a single storage slot per name (`globalThis.x`) and no
   local binding, a top-level function that closes over `x` and a later cell
   that reads `x` resolve to the **same** slot — a mutation is observed
   everywhere (true Jupyter-like sharing, not a stale copy). Re-running a
   cell with `const x = 1` is also safe: it is just a re-assignment of
   `globalThis.x`, never a redeclaration clash.

Because scope is real interpreter state (not a serialized copy), functions,
closures and class instances survive across cells — unlike a data-only
snapshot, which could only carry plain values. Nested declarations (inside
`if`, `for`, function bodies, etc.) are left untouched: their scope stays
private to the block.

**Restart Kernel** terminates the worker (dropping the VM), and resets
`execCounterAtom`, `queueAtom`, and every cell's `executionCount` /
`status` / `output`. The next run spins up a fresh kernel with empty scope.

**Deleting a cell does NOT remove its variables.** Jupyter semantics:
once a binding made it into the kernel, it stays until Restart.

`import` / `export` (static, dynamic `import(...)`, and `import.meta`) are
rejected with a clear error — the kernel has no ESM module loader.
`new.target` is **not** affected: it shares the `MetaProperty` AST node with
`import.meta` but is left untouched.

---

## Stop and timeout

The kernel's `setInterruptHandler` runs synchronously between bytecode ops
and can abort the current evaluation **without destroying the VM**, so the
shared scope survives. It fires on three causes, and records which:

1. **Timeout.** A per-run deadline (`timeoutMs`). Aborts `while(true){}`
   even though the VM has no `await` point → status `'timeout'`.
2. **User stop.** `stopCell` / `stopAll` flip a `SharedArrayBuffer` flag
   that the handler reads. Because the buffer is shared, the host can set
   it even while the worker thread is blocked in a tight loop → status
   `'interrupted'`, scope preserved.
3. **Output budget.** The kernel itself aborts once cumulative output
   exceeds the budget (see Limits) → status `'error'`.

A deadline / user-stop / budget abort surfaces a synthetic
`InternalError("interrupted")` inside the VM. The kernel **swallows** that
synthetic error (it carries no user value) and lets the status drive a
single explicit marker — no confusing red "InternalError" on top of the
friendly note.

The SAB path requires a cross-origin isolated context (COOP/COEP headers,
see `auth.md` § Cross-origin isolation). The SAB flag only aborts a VM that
is **running bytecode**; code parked in a pending promise
(`await new Promise(() => {})`) never reaches the handler. So a Stop arms a
**watchdog** (`INTERRUPT_WATCHDOG_MS`, 250 ms): if the cooperative interrupt
hasn't landed, the host falls back to `worker.terminate()` + respawn — the
run still stops `'interrupted'` (scope is lost in that case). The same
fallback is the only path **without isolation**. A host-side
`setTimeout(timeoutMs + 100)` terminate remains as a last-resort safety net.

`stopCell` only interrupts when its cell is the one actually running; a
merely-queued cell is just dropped from the queue. The interrupted/timeout
cell gets an explicit stderr marker in its output.

---

## Limits

| Limit          | Default                 | Configurable via                               |
| -------------- | ----------------------- | ---------------------------------------------- |
| Execution time | 30 s                    | `runInWorker(code, { timeoutMs })`             |
| Output size    | 5 MB cumulative per run | `runtime/outputBudget.ts: OUTPUT_BUDGET_BYTES` |

The budget is enforced in **two layers** (`runtime/outputBudget.ts` is the
shared definition):

1. **In the kernel (primary).** `pushItem` tracks cumulative bytes as
   `console.*` / `display` / result items are produced. On overflow it
   records one `{ type: 'stderr', text: 'Output truncated at <N> bytes' }`
   marker and trips the interrupt handler, so a runaway
   `for(;;) console.log(...)` is stopped **while running** — the worker
   cannot grow its memory without bound. Status → `error`.
2. **In the host (defense-in-depth).** `workerHost` re-checks the size of
   items it receives, covering an injected / fake worker that bypasses the
   kernel. On overflow it appends the same marker, terminates the worker,
   and resolves the run as `error`.

The check happens **before** each item is accepted, so a single huge item
cannot blow past the limit.

---

## Cell state machine

```
idle ──(runCell)──▶ running ──(success)─▶ done
                      │
                      ├──(error)────────▶ error
                      ├──(deadline)─────▶ timeout
                      └──(stopCell)─────▶ interrupted
```

`runAll` evaluates the whole notebook: it switches every markdown cell to
preview (rendering is a text cell's "run") and puts every code cell in the
queue. The first non-`done` status short-circuits the rest as `skipped`.

| Status        | Border / Lead-bar          | Run button | Output      |
| ------------- | -------------------------- | ---------- | ----------- |
| `idle`        | default                    | green play | hidden      |
| `running`     | primary lead-bar           | red stop   | partial     |
| `done`        | default                    | green play | visible     |
| `error`       | red (`border-destructive`) | green play | red         |
| `timeout`     | amber                      | green play | stderr note |
| `interrupted` | amber                      | green play | stderr note |
| `skipped`     | dashed muted               | green play | empty       |

---

## ExecutionCount badge

Each cell shows `[N]` in its header — the **execution counter** value
at the time of its last run. Editing the code does **not** change it.
Only Restart Kernel resets the counter. A cell that never ran shows
`[ ]`.

---

## Related files

| File                                              | Layer                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/features/notebook/runtime/types.ts`          | Worker protocol + OutputItem + SerializedValue                                |
| `src/features/notebook/runtime/serialize.ts`      | Safe walk to depth 5, cycle-safe                                              |
| `src/features/notebook/runtime/transform.ts`      | acorn AST: publish declarations to globalThis + trailing return               |
| `src/features/notebook/runtime/quickjs.ts`        | Persistent QuickJS kernel: console, interrupt (deadline + SAB), async IIFE    |
| `src/features/notebook/runtime/interrupt.ts`      | Worker-side `SharedArrayBuffer` interrupt flag                                |
| `src/features/notebook/runtime/worker.ts`         | Worker entrypoint, owns the persistent kernel                                 |
| `src/features/notebook/runtime/workerHost.ts`     | Main-thread facade, timeout, output budget, SAB interrupt, `setWorkerFactory` |
| `src/features/notebook/model/notebook.ts`         | `cellsAtom`, CRUD                                                             |
| `src/features/notebook/model/notebookSettings.ts` | `timeoutMsAtom` and default / max limits                                      |
| `src/features/notebook/model/runtime.ts`          | `runCell`, `runAll`, `resumeQueue`, `stopCell`, `stopAll`, `restartKernel`    |
| `src/features/notebook/domain/cell.ts`            | `reatomCell()` factory, atomized fields                                       |
| `src/features/notebook/ui/OutputView.tsx`         | Renders `OutputItem[]`                                                        |
| `src/features/notebook/ui/OutputFrame.tsx`        | Sandboxed iframe for `html` items                                             |
| `src/features/notebook/ui/NotebookToolbar.tsx`    | Run All / Continue / Stop All / Restart                                       |
| `src/features/notebook/ui/NotebookCell.tsx`       | Per-cell UI with Stop button                                                  |
