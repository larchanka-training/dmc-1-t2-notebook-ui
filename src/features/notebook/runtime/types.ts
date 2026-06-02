// Public type contract of the JS execution runtime.
//
// Two layers communicate here:
//   1. Host facade (workerHost.ts) ↔ Web Worker (worker.ts) via postMessage.
//   2. Worker thread ↔ QuickJS kernel (quickjs.ts) — pure function call.
//
// The kernel is *persistent*: a single QuickJS VM lives for the lifetime of
// the worker, so `let`/`const`/`function`/`class` declared in one cell stay
// visible in the next (real Jupyter-like shared scope). Because the scope
// lives inside the VM, it never crosses the postMessage boundary — there is
// no serialized scope snapshot in the protocol.

/** Terminal status of a single run. */
export type RuntimeStatus = 'done' | 'error' | 'timeout' | 'interrupted'

/**
 * Safe representation of any JS value that crosses the worker postMessage
 * boundary or gets persisted in a notebook. Recursion stops at depth 5;
 * deeper structures get `kind: 'truncated'`.
 */
export type SerializedValue =
  | { kind: 'primitive'; value: string | number | boolean | null }
  | { kind: 'undefined' }
  | { kind: 'array'; items: SerializedValue[] }
  | { kind: 'object'; entries: Array<[string, SerializedValue]> }
  | { kind: 'truncated'; placeholder: string }
  | { kind: 'function'; name: string }

/** A single piece of output produced during code execution. */
export type OutputItem =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'result'; value: SerializedValue }
  | { type: 'error'; name: string; message: string; stack?: string }
  /** HTML to render inside a sandboxed iframe. Provided by user code via `display({ type: 'html', value })`. */
  | { type: 'html'; html: string }
  /** Base64-encoded image. MIME like `image/png` / `image/svg+xml`. */
  | { type: 'image'; mime: string; data: string }

/** Final result of a single run. Scope is not returned — it lives in the VM. */
export interface RuntimeResult {
  status: RuntimeStatus
  items: OutputItem[]
}

// ─── Worker protocol ─────────────────────────────────────────────────────────

/** Messages sent host → worker. */
export type HostMsg =
  /** Hand the worker a SharedArrayBuffer whose first int32 is the interrupt
   *  flag. Sent once, right after the worker is created, only in a
   *  cross-origin isolated context. Lets the host stop a blocked VM without
   *  destroying it (the shared scope survives). */
  | { kind: 'init'; interruptBuffer: SharedArrayBuffer }
  | { kind: 'run'; runId: string; code: string; timeoutMs: number }

/** Messages sent worker → host. */
export type WorkerMsg =
  | { kind: 'output'; runId: string; item: OutputItem }
  | { kind: 'done'; runId: string; status: RuntimeStatus }
