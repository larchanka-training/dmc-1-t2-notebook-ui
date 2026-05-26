// Public type contract of the JS execution runtime.
//
// Two layers communicate here:
//   1. Host facade (workerHost.ts) ↔ Web Worker (worker.ts) via postMessage.
//   2. Worker thread ↔ QuickJS sandbox (quickjs.ts) — pure function call.
//
// Both layers speak the same OutputItem[] and SerializedValue types, so a
// notebook cell ends up with structured output it can render directly.

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

/**
 * Shared scope between cells (Jupyter-like). Snapshot of user-defined
 * top-level bindings carried between runs as plain values (serialized
 * via structured clone — postMessage friendly).
 *
 * Commit 1 carries this through as a placeholder (empty object). The
 * acorn-based transform in Commit 2 fills it.
 */
export type SharedScope = Record<string, unknown>

/** Final result of a single run, regardless of whether it ran in main thread or worker. */
export interface RuntimeResult {
  status: RuntimeStatus
  items: OutputItem[]
  /** Updated shared scope to carry into the next run. */
  scope: SharedScope
}

// ─── Worker protocol ─────────────────────────────────────────────────────────

/** Messages sent host → worker. */
export type HostMsg =
  | { kind: 'run'; runId: string; code: string; scope: SharedScope; timeoutMs: number }
  | { kind: 'reset' }

/** Messages sent worker → host. */
export type WorkerMsg =
  | { kind: 'output'; runId: string; item: OutputItem }
  | { kind: 'done'; runId: string; status: RuntimeStatus; scope: SharedScope }
