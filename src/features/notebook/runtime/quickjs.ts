// Sandboxed JS runtime built on quickjs-emscripten.
//
// Public contract — a *kernel* (persistent VM) with two methods:
//
//   const kernel = await createKernel(options?)
//   const result = await kernel.run(code, { timeoutMs })  // → RuntimeResult
//   kernel.dispose()
//
// The kernel holds a single QuickJSContext for its entire lifetime, so
// `let`/`const`/`function`/`class` declared in cell N are visible in cell
// N+1 natively — no hand-rolled scope snapshot, no serialization. Each call
// to `run`:
//   - wraps the user code in an async IIFE so top-level `await` works;
//   - rewrites top-level declarations through `transformCellCode` so they
//     also publish to `globalThis` (otherwise the IIFE body would scope
//     them locally and the next cell could not see them);
//   - installs a fresh deadline-based interrupt handler — an infinite loop
//     is broken without destroying the VM, the scope survives;
//   - returns structured `OutputItem[]` plus a terminal status.
//
// `run` never throws — any failure surfaces as an `error` item.

import {
  newQuickJSWASMModuleFromVariant,
  RELEASE_SYNC,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten'

import { DEFAULT_TIMEOUT_MS } from './limits'
import { OUTPUT_BUDGET_BYTES, measureItemBytes } from './outputBudget'
import { serialize } from './serialize'
import { transformCellCode } from './transform'
import type { OutputItem, RuntimeResult, RuntimeStatus, SerializedValue } from './types'

/**
 * Output accumulator shared by console / display capture and the result
 * push. Tracks the cumulative byte size so the kernel can abort a run that
 * blows past the output budget *while it is still producing output* — the
 * host-side check only sees data after the run finishes.
 */
interface Sink {
  items: OutputItem[]
  bytes: number
  budgetHit: boolean
}

/**
 * Append an item unless the per-run output budget is already exhausted. On
 * the first overflow it records a single truncation marker and flips
 * `budgetHit`, which the interrupt handler reads to abort the run.
 */
function pushItem(sink: Sink, item: OutputItem): void {
  if (sink.budgetHit) return
  const size = measureItemBytes(item)
  if (sink.bytes + size > OUTPUT_BUDGET_BYTES) {
    sink.budgetHit = true
    sink.items.push({ type: 'stderr', text: `Output truncated at ${OUTPUT_BUDGET_BYTES} bytes` })
    return
  }
  sink.bytes += size
  sink.items.push(item)
}

export interface RuntimeOptions {
  /** Hard upper bound for execution time, in ms. Default 30_000. */
  timeoutMs?: number
}

export interface Kernel {
  run(code: string, options?: RuntimeOptions): Promise<RuntimeResult>
  dispose(): void
}

export interface KernelOptions {
  /**
   * Optional user-stop signal. When it returns true the current run aborts
   * with status `interrupted` (distinct from a deadline `timeout`). Backed
   * by a SharedArrayBuffer flag in the worker, so it can break a blocked VM.
   */
  shouldInterrupt?: () => boolean
}

/**
 * Load exactly one QuickJS WASM variant (single-file release-sync) instead of
 * the multi-variant `getQuickJS()` default, which makes the bundler emit
 * several `emscripten-module-*.wasm` files of which only one is ever used.
 * Memoized so all kernels share a single module instance.
 */
let modulePromise: Promise<QuickJSWASMModule> | null = null
function getModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) modulePromise = newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
  return modulePromise
}

/** Create a fresh persistent kernel. */
export async function createKernel(options: KernelOptions = {}): Promise<Kernel> {
  const QuickJS = await getModule()
  const vm = QuickJS.newContext()
  // Items array is rebound per-run, but console / display capture it via
  // this mutable ref so we only have to install them once.
  const sink: Sink = { items: [], bytes: 0, budgetHit: false }
  installConsole(vm, sink)
  installDisplay(vm, sink)

  return {
    async run(code, runOptions = {}): Promise<RuntimeResult> {
      return runOne(
        vm,
        sink,
        code,
        runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.shouldInterrupt,
      )
    },
    dispose() {
      vm.dispose()
    },
  }
}

async function runOne(
  vm: QuickJSContext,
  sink: Sink,
  code: string,
  timeoutMs: number,
  shouldInterrupt?: () => boolean,
): Promise<RuntimeResult> {
  const items: OutputItem[] = []
  sink.items = items
  sink.bytes = 0
  sink.budgetHit = false

  // 1) AST transform: publish top-level declarations to globalThis + return
  //    the trailing expression (if any). Reject import/export early with a
  //    readable SyntaxError.
  let transformed: string
  try {
    transformed = transformCellCode(code).code
  } catch (err) {
    items.push({
      type: 'error',
      name: 'SyntaxError',
      message: err instanceof Error ? err.message : String(err),
    })
    return { status: 'error', items }
  }

  // 2) Arm the interrupt handler. It aborts on the deadline (timeout), a user
  //    stop (shouldInterrupt), or the output budget being exhausted. The
  //    handler runs synchronously between bytecode ops and does NOT destroy
  //    the VM, only aborts the current evaluation — so the shared scope
  //    survives. We record which cause fired to classify the abort precisely
  //    (no message sniffing). Everything after arming is wrapped so the
  //    handler is always removed, even on an early eval error.
  const abort = armInterrupt(vm, timeoutMs, sink, shouldInterrupt)
  try {
    // 3) Eval wrapped in async IIFE — supports `await`, returns a Promise.
    const wrapped = `(async () => { ${transformed}\n })()`
    const evalResult = vm.evalCode(wrapped)
    if (evalResult.error) {
      pushAbortAware(sink, abort.cause, () => toErrorItem(vm, evalResult.error))
      evalResult.error.dispose()
      return { status: classifyAbort(abort.cause), items }
    }

    let status: RuntimeStatus = 'done'
    try {
      const resolved = vm.resolvePromise(evalResult.value)
      // Drain the VM microtask queue so the IIFE promise (and every chained
      // `await` inside it) settles. `executePendingJobs()` with no argument
      // runs ALL queued jobs, including ones scheduled while draining, so a
      // multi-step `await a; await b` chain completes in this single call.
      // The result is Disposable — dispose it to avoid leaking the handle.
      vm.runtime.executePendingJobs().dispose()
      const awaited = await resolved
      if (awaited.error) {
        pushAbortAware(sink, abort.cause, () => toErrorItem(vm, awaited.error))
        awaited.error.dispose()
        status = classifyAbort(abort.cause)
      } else {
        pushResultIfMeaningful(vm, awaited.value, sink)
        awaited.value.dispose()
      }
    } finally {
      evalResult.value.dispose()
    }
    return { status, items }
  } finally {
    vm.runtime.removeInterruptHandler()
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

type AbortCause = 'none' | 'timeout' | 'interrupt' | 'budget'

/**
 * QuickJS calls this handler frequently while interpreting bytecode.
 * Returning true tells the VM to abort with an InternalError("interrupted").
 * After abort, the VM stays alive — only the current eval is unwound.
 *
 * Three causes can fire: the deadline (timeout), a user stop
 * (shouldInterrupt), or the output budget being exhausted (sink.budgetHit,
 * set by pushItem). We record the first one so the caller can map the abort
 * to the right status without sniffing the error message.
 */
function armInterrupt(
  vm: QuickJSContext,
  timeoutMs: number,
  sink: Sink,
  shouldInterrupt?: () => boolean,
): { readonly cause: AbortCause } {
  const deadline = Date.now() + timeoutMs
  const state = { cause: 'none' as AbortCause }
  vm.runtime.setInterruptHandler(() => {
    if (shouldInterrupt?.()) {
      state.cause = 'interrupt'
      return true
    }
    if (sink.budgetHit) {
      state.cause = 'budget'
      return true
    }
    if (Date.now() > deadline) {
      state.cause = 'timeout'
      return true
    }
    return false
  })
  return state
}

/**
 * Push an error item only for a genuine error. A timeout / user-interrupt /
 * budget abort surfaces a synthetic InternalError("interrupted") from
 * QuickJS that carries no user value — the caller already adds an explicit
 * status marker, so swallowing the synthetic error avoids a confusing double
 * output (red "InternalError: interrupted" + the friendly note).
 */
function pushAbortAware(sink: Sink, cause: AbortCause, makeItem: () => OutputItem): void {
  if (cause !== 'none') return
  pushItem(sink, makeItem())
}

/**
 * Inject the Jupyter-style `display()` API. User code calls
 *   display({ type: 'html', value: '<b>x</b>' })
 *   display({ type: 'image', mime: 'image/png', data: '<base64>' })
 * and the host receives a matching OutputItem.
 */
function installDisplay(vm: QuickJSContext, sink: Sink): void {
  const fn = vm.newFunction('display', (payloadHandle) => {
    if (!payloadHandle) return
    let payload: unknown
    try {
      payload = vm.dump(payloadHandle) as unknown
    } catch {
      return
    }
    const item = displayPayloadToItem(payload)
    if (item) pushItem(sink, item)
  })
  vm.setProp(vm.global, 'display', fn)
  fn.dispose()
}

function displayPayloadToItem(payload: unknown): OutputItem | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { type?: unknown; value?: unknown; mime?: unknown; data?: unknown }
  if (p.type === 'html' && typeof p.value === 'string') {
    return { type: 'html', html: p.value }
  }
  if (p.type === 'image' && typeof p.mime === 'string' && typeof p.data === 'string') {
    // Only well-known image MIME types are allowed — `<img>` shouldn't
    // receive arbitrary user-controlled MIME strings.
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(p.mime)) return null
    return { type: 'image', mime: p.mime, data: p.data }
  }
  return null
}

/** Inject a minimal console object that pushes into the host-side `items`. */
function installConsole(vm: QuickJSContext, sink: Sink): void {
  const consoleHandle = vm.newObject()
  const channels: Array<{
    name: 'log' | 'info' | 'warn' | 'error'
    toItem: (text: string) => OutputItem
  }> = [
    { name: 'log', toItem: (text) => ({ type: 'stdout', text }) },
    { name: 'info', toItem: (text) => ({ type: 'stdout', text }) },
    { name: 'warn', toItem: (text) => ({ type: 'stderr', text: `[warn] ${text}` }) },
    { name: 'error', toItem: (text) => ({ type: 'stderr', text: `[error] ${text}` }) },
  ]
  for (const { name, toItem } of channels) {
    const fn = vm.newFunction(name, (...args) => {
      // quickjs-emscripten auto-disposes argument handles when the
      // callback returns; we MUST NOT call `dispose()` on them ourselves.
      const text = args.map((arg) => stringifyArg(vm, arg)).join(' ')
      pushItem(sink, toItem(text))
    })
    vm.setProp(consoleHandle, name, fn)
    fn.dispose()
  }
  vm.setProp(vm.global, 'console', consoleHandle)
  consoleHandle.dispose()
}

/**
 * Build an `error` OutputItem from a QuickJS exception handle.
 * Best-effort: pulls name/message/stack if shaped like an Error,
 * otherwise serializes the dumped value into the message.
 */
function toErrorItem(vm: QuickJSContext, errorHandle: QuickJSHandle): OutputItem {
  let dumped: unknown
  try {
    dumped = vm.dump(errorHandle) as unknown
  } catch {
    return { type: 'error', name: 'Error', message: 'unknown error (failed to dump)' }
  }
  if (dumped && typeof dumped === 'object') {
    const e = dumped as { name?: unknown; message?: unknown; stack?: unknown }
    const name = typeof e.name === 'string' && e.name ? e.name : 'Error'
    const message = typeof e.message === 'string' ? e.message : safeToString(dumped)
    const stack = typeof e.stack === 'string' ? e.stack : undefined
    return { type: 'error', name, message, stack }
  }
  return { type: 'error', name: 'Error', message: safeToString(dumped) }
}

/**
 * Map an abort cause to a run status. A plain error (cause 'none') stays
 * 'error'; a deadline abort is 'timeout'; a user stop is 'interrupted'.
 */
function classifyAbort(cause: AbortCause): RuntimeStatus {
  if (cause === 'timeout') return 'timeout'
  if (cause === 'interrupt') return 'interrupted'
  // A budget overflow is a hard stop: the truncation marker is already in the
  // output, and the run did not complete, so surface it as an error.
  if (cause === 'budget') return 'error'
  return 'error'
}

function safeToString(value: unknown): string {
  try {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Stringify a single console.log argument. The argument handle is borrowed
 * from quickjs-emscripten; do NOT dispose it here.
 */
function stringifyArg(vm: QuickJSContext, handle: QuickJSHandle): string {
  let dumped: unknown
  try {
    dumped = vm.dump(handle) as unknown
  } catch {
    return '[unprintable]'
  }
  if (dumped === undefined) return 'undefined'
  if (dumped === null) return 'null'
  if (typeof dumped === 'string') return dumped
  if (typeof dumped === 'number' || typeof dumped === 'boolean') return String(dumped)
  // Objects/arrays: prefer compact JSON. JSON.stringify throws on cycles and
  // BigInt, so fall back to the safe serializer's own formatter — NOT another
  // JSON.stringify pass (that would just throw again on the same value).
  try {
    const json = JSON.stringify(dumped)
    if (json !== undefined) return json
  } catch {
    // fall through to the serializer-based path
  }
  return formatSerialized(serialize(dumped))
}

/**
 * Render a SerializedValue to a compact one-line string. Used as the
 * cycle/BigInt-safe fallback when JSON.stringify can't handle a console.log
 * argument. Mirrors the UI's formatter but lives here so the worker has no UI
 * dependency.
 */
function formatSerialized(value: SerializedValue): string {
  switch (value.kind) {
    case 'primitive':
      return typeof value.value === 'string' ? JSON.stringify(value.value) : String(value.value)
    case 'undefined':
      return 'undefined'
    case 'function':
      return `[Function: ${value.name}]`
    case 'truncated':
      return value.placeholder
    case 'array':
      return `[${value.items.map(formatSerialized).join(', ')}]`
    case 'object':
      return `{ ${value.entries.map(([k, v]) => `${k}: ${formatSerialized(v)}`).join(', ')} }`
  }
}

/**
 * The async IIFE has a final completion value. Skip undefined, otherwise
 * push it as a `result` item.
 */
function pushResultIfMeaningful(vm: QuickJSContext, valueHandle: QuickJSHandle, sink: Sink): void {
  let dumped: unknown
  try {
    dumped = vm.dump(valueHandle) as unknown
  } catch {
    return
  }
  if (dumped === undefined) return
  pushItem(sink, { type: 'result', value: serialize(dumped) })
}
