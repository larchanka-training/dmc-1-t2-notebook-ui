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

import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'

import { serialize } from './serialize'
import { transformCellCode } from './transform'
import type { OutputItem, RuntimeResult, RuntimeStatus } from './types'

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

const DEFAULT_TIMEOUT_MS = 30_000

/** Create a fresh persistent kernel. */
export async function createKernel(options: KernelOptions = {}): Promise<Kernel> {
  const QuickJS = await getQuickJS()
  const vm = QuickJS.newContext()
  // Items array is rebound per-run, but console / display capture it via
  // this mutable ref so we only have to install them once.
  const sink: { items: OutputItem[] } = { items: [] }
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
  sink: { items: OutputItem[] },
  code: string,
  timeoutMs: number,
  shouldInterrupt?: () => boolean,
): Promise<RuntimeResult> {
  const items: OutputItem[] = []
  sink.items = items

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

  // 2) Arm the interrupt handler. It aborts on either the deadline (timeout)
  //    or a user stop (shouldInterrupt). The handler runs synchronously
  //    between bytecode ops and does NOT destroy the VM, only aborts the
  //    current evaluation — so the shared scope survives. We record which
  //    cause fired to classify the abort precisely (no message sniffing).
  const abort = armInterrupt(vm, timeoutMs, shouldInterrupt)

  // 3) Eval wrapped in async IIFE — supports `await` and returns a Promise.
  const wrapped = `(async () => { ${transformed}\n })()`
  const evalResult = vm.evalCode(wrapped)
  if (evalResult.error) {
    items.push(toErrorItem(vm, evalResult.error))
    evalResult.error.dispose()
    return { status: classifyAbort(abort.cause), items }
  }

  let status: RuntimeStatus = 'done'
  try {
    const resolved = vm.resolvePromise(evalResult.value)
    vm.runtime.executePendingJobs()
    const awaited = await resolved
    if (awaited.error) {
      items.push(toErrorItem(vm, awaited.error))
      awaited.error.dispose()
      status = classifyAbort(abort.cause)
    } else {
      pushResultIfMeaningful(vm, awaited.value, items)
      awaited.value.dispose()
    }
  } finally {
    evalResult.value.dispose()
    vm.runtime.removeInterruptHandler()
  }

  return { status, items }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

type AbortCause = 'none' | 'timeout' | 'interrupt'

/**
 * QuickJS calls this handler frequently while interpreting bytecode.
 * Returning true tells the VM to abort with an InternalError("interrupted").
 * After abort, the VM stays alive — only the current eval is unwound.
 *
 * Two causes can fire: the deadline (timeout) or a user stop
 * (shouldInterrupt). We record the first one so the caller can map the
 * abort to the right status without sniffing the error message.
 */
function armInterrupt(
  vm: QuickJSContext,
  timeoutMs: number,
  shouldInterrupt?: () => boolean,
): { readonly cause: AbortCause } {
  const deadline = Date.now() + timeoutMs
  const state = { cause: 'none' as AbortCause }
  vm.runtime.setInterruptHandler(() => {
    if (shouldInterrupt?.()) {
      state.cause = 'interrupt'
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
 * Inject the Jupyter-style `display()` API. User code calls
 *   display({ type: 'html', value: '<b>x</b>' })
 *   display({ type: 'image', mime: 'image/png', data: '<base64>' })
 * and the host receives a matching OutputItem.
 */
function installDisplay(vm: QuickJSContext, sink: { items: OutputItem[] }): void {
  const fn = vm.newFunction('display', (payloadHandle) => {
    if (!payloadHandle) return
    let payload: unknown
    try {
      payload = vm.dump(payloadHandle) as unknown
    } catch {
      return
    }
    const item = displayPayloadToItem(payload)
    if (item) sink.items.push(item)
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
function installConsole(vm: QuickJSContext, sink: { items: OutputItem[] }): void {
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
      sink.items.push(toItem(text))
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
  try {
    return JSON.stringify(dumped) ?? safeToString(serialize(dumped))
  } catch {
    return safeToString(serialize(dumped))
  }
}

/**
 * The async IIFE has a final completion value. Skip undefined, otherwise
 * push it as a `result` item.
 */
function pushResultIfMeaningful(
  vm: QuickJSContext,
  valueHandle: QuickJSHandle,
  items: OutputItem[],
): void {
  let dumped: unknown
  try {
    dumped = vm.dump(valueHandle) as unknown
  } catch {
    return
  }
  if (dumped === undefined) return
  items.push({ type: 'result', value: serialize(dumped) })
}
