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
import { transformCellCode } from './transform'
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
    installDisplay(vm, items)
    armInterrupt(vm, timeoutMs)
    installScope(vm, scope)

    // Transform user code: prelude (`const x = globalThis.__ctx.x`), top-level
    // declarations lifted into __ctx, trailing ExpressionStatement → return.
    let transformed: string
    try {
      transformed = transformCellCode(code, scope).code
    } catch (err) {
      items.push({
        type: 'error',
        name: 'SyntaxError',
        message: err instanceof Error ? err.message : String(err),
      })
      return { status: 'error', items, scope }
    }

    const wrapped = `(async () => { ${transformed}\n })()`
    const evalResult = vm.evalCode(wrapped)
    if (evalResult.error) {
      items.push(toErrorItem(vm, evalResult.error))
      evalResult.error.dispose()
      return { status: 'error', items, scope: extractScope(vm) }
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

    return { status, items, scope: extractScope(vm) }
  } finally {
    vm.dispose()
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Set `globalThis.__ctx` inside the VM. Transformed user code reads from
 * and writes to this object — prelude binds locals from it, top-level
 * declarations write back into it.
 */
function installScope(vm: QuickJSContext, scope: SharedScope): void {
  const ctx = vm.newObject()
  for (const key of Object.keys(scope)) {
    const handle = jsToHandle(vm, scope[key])
    if (handle) {
      vm.setProp(ctx, key, handle)
      handle.dispose()
    }
  }
  vm.setProp(vm.global, '__ctx', ctx)
  ctx.dispose()
}

/**
 * Read `globalThis.__ctx` out of the VM after a run, converting it back
 * into a plain JS object for postMessage. Only structured-clone-safe
 * values are preserved; functions/symbols get dropped at the boundary.
 */
function extractScope(vm: QuickJSContext): SharedScope {
  const handle = vm.getProp(vm.global, '__ctx')
  try {
    const dumped = vm.dump(handle) as unknown
    if (!dumped || typeof dumped !== 'object') return {}
    const result: SharedScope = {}
    for (const [key, value] of Object.entries(dumped)) {
      if (isStructuredCloneSafe(value)) result[key] = value
    }
    return result
  } finally {
    handle.dispose()
  }
}

/**
 * Convert a host-side JS value into a VM handle. Only the subset we know
 * survives across postMessage is supported — strings, finite numbers,
 * booleans, null, plain objects/arrays. Anything else is silently dropped.
 */
function jsToHandle(vm: QuickJSContext, value: unknown): QuickJSHandle | null {
  if (value === null) return vm.null
  if (value === undefined) return vm.undefined
  if (typeof value === 'string') return vm.newString(value)
  if (typeof value === 'number' && Number.isFinite(value)) return vm.newNumber(value)
  if (typeof value === 'boolean') return value ? vm.true : vm.false
  if (Array.isArray(value)) {
    const arr = vm.newArray()
    value.forEach((item, idx) => {
      const childHandle = jsToHandle(vm, item)
      if (childHandle) {
        vm.setProp(arr, idx, childHandle)
        childHandle.dispose()
      }
    })
    return arr
  }
  if (typeof value === 'object') {
    const obj = vm.newObject()
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childHandle = jsToHandle(vm, v)
      if (childHandle) {
        vm.setProp(obj, k, childHandle)
        childHandle.dispose()
      }
    }
    return obj
  }
  return null
}

function isStructuredCloneSafe(value: unknown): boolean {
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(value as number)
  if (Array.isArray(value)) return value.every(isStructuredCloneSafe)
  if (t === 'object') {
    return Object.values(value as Record<string, unknown>).every(isStructuredCloneSafe)
  }
  return false
}

/**
 * Inject the Jupyter-style `display()` API: user code calls
 * `display({ type: 'html', value: '<b>x</b>' })` or
 * `display({ type: 'image', mime: 'image/png', data: '<base64>' })`
 * and the host receives a matching OutputItem.
 *
 * Why a function and not magic-on-trailing-return: explicit > implicit.
 * The user controls when a rich block is produced and never has to
 * worry about a stray `<div>` string getting auto-promoted.
 */
function installDisplay(vm: QuickJSContext, items: OutputItem[]): void {
  const fn = vm.newFunction('display', (payloadHandle) => {
    if (!payloadHandle) return
    const payload = vm.dump(payloadHandle) as unknown
    const item = displayPayloadToItem(payload)
    if (item) items.push(item)
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
    return { type: 'image', mime: p.mime, data: p.data }
  }
  return null
}

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
