// Sandboxed JS runtime built on quickjs-emscripten.
//
// Public contract:
//   runInQuickJS(code, scope?, options?) → Promise<RuntimeResult>
//
// - `code` is wrapped in an async IIFE so top-level await works.
// - `console.log/info/warn/error` are injected; everything else is gone
//   (no window, no document, no fetch — that's the whole point).
// - A deadline-based interrupt handler stops infinite loops.
// - The trailing value of the IIFE is collected as a `result` OutputItem.
// - The function never throws — any failure surfaces as an `error` item
//   with status='error'.

import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'

import { serialize } from './serialize'
import type { OutputItem, RuntimeResult, RuntimeStatus, SharedScope } from './types'

export interface RuntimeOptions {
  /** Hard upper bound for execution time, in ms. Default 30_000. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Run user `code` inside a fresh QuickJS context. */
export async function runInQuickJS(
  code: string,
  scope: SharedScope = {},
  options: RuntimeOptions = {},
): Promise<RuntimeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const QuickJS = await getQuickJS()
  const vm = QuickJS.newContext()
  const items: OutputItem[] = []

  try {
    installConsole(vm, items)
    armInterrupt(vm, timeoutMs)

    const wrapped = `(async () => { ${code}\n })()`
    const evalResult = vm.evalCode(wrapped)
    if (evalResult.error) {
      items.push(toErrorItem(vm, evalResult.error))
      evalResult.error.dispose()
      return { status: 'error', items, scope }
    }

    const promiseHandle = evalResult.value
    let status: RuntimeStatus = 'done'
    try {
      const resolved = vm.resolvePromise(promiseHandle)
      vm.runtime.executePendingJobs()
      const awaited = await resolved
      if (awaited.error) {
        items.push(toErrorItem(vm, awaited.error))
        awaited.error.dispose()
        status = 'error'
      } else {
        pushResultIfMeaningful(vm, awaited.value, items)
        awaited.value.dispose()
      }
    } finally {
      promiseHandle.dispose()
    }

    return { status, items, scope }
  } finally {
    vm.dispose()
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Inject a minimal console object that pushes into the host-side `items`. */
function installConsole(vm: QuickJSContext, items: OutputItem[]): void {
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
      const text = args.map((arg) => stringifyArg(vm, arg)).join(' ')
      items.push(toItem(text))
    })
    vm.setProp(consoleHandle, name, fn)
    fn.dispose()
  }
  vm.setProp(vm.global, 'console', consoleHandle)
  consoleHandle.dispose()
}

/**
 * QuickJS calls this handler frequently while interpreting bytecode.
 * Returning true tells the VM to abort with an InternalError("interrupted").
 */
function armInterrupt(vm: QuickJSContext, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs
  vm.runtime.setInterruptHandler(() => Date.now() > deadline)
}

/**
 * Build an `error` OutputItem from a QuickJS exception handle.
 * Best-effort: pulls name/message/stack if shaped like an Error,
 * otherwise serializes the dumped value into the message.
 */
function toErrorItem(vm: QuickJSContext, errorHandle: QuickJSHandle): OutputItem {
  const dumped = vm.dump(errorHandle) as unknown
  if (dumped && typeof dumped === 'object') {
    const e = dumped as { name?: unknown; message?: unknown; stack?: unknown }
    const name = typeof e.name === 'string' && e.name ? e.name : 'Error'
    const message = typeof e.message === 'string' ? e.message : safeToString(dumped)
    const stack = typeof e.stack === 'string' ? e.stack : undefined
    return { type: 'error', name, message, stack }
  }
  return { type: 'error', name: 'Error', message: safeToString(dumped) }
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
 * Stringify a single console.log argument. Primitives go straight, objects
 * are rendered as JSON via the serialize step (so cycles and depth are safe).
 */
function stringifyArg(vm: QuickJSContext, handle: QuickJSHandle): string {
  const dumped = vm.dump(handle) as unknown
  handle.dispose()
  if (dumped === undefined) return 'undefined'
  if (dumped === null) return 'null'
  if (typeof dumped === 'string') return dumped
  if (typeof dumped === 'number' || typeof dumped === 'boolean') return String(dumped)
  // Object-ish — go through serialize and render compactly.
  try {
    return JSON.stringify(dumped)
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
  const dumped = vm.dump(valueHandle) as unknown
  if (dumped === undefined) return
  items.push({ type: 'result', value: serialize(dumped) })
}
