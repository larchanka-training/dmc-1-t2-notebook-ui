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

// Import the variant DIRECTLY from its subpackage (not via the
// `quickjs-emscripten` umbrella, whose re-exports drag every WASM variant
// into the bundle). This way the bundler emits exactly one
// `emscripten-module-*.wasm` instead of four.
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync'

import { DEFAULT_TIMEOUT_MS } from './limits'
import { OUTPUT_BUDGET_BYTES, OUTPUT_ITEM_LIMIT, measureItemBytes } from './outputBudget'
import { serialize } from './serialize'
import { TRAILING_MARKER, transformCellCode } from './transform'
import type { OutputItem, RuntimeResult, RuntimeStatus, SerializedValue } from './types'

/**
 * Hard memory cap for the persistent VM (bytes). Generous enough for an
 * ordinary multi-cell notebook's shared scope, low enough that a runaway
 * allocation (`for(;;) a.push(...)`) surfaces as a clean QuickJS error
 * instead of growing the worker until the browser kills the tab.
 */
const VM_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024
/**
 * Max VM stack (bytes). Bounds unbounded recursion into a catchable error
 * rather than a worker crash. Kept above QuickJS's tiny default so ordinary
 * recursive notebook code (and our async-IIFE wrapper) has room.
 */
const VM_MAX_STACK_BYTES = 1024 * 1024

/**
 * Diagnostic attached to the `error` item when a cell's trailing expression
 * evaluated to a rejected Promise (the most common "forgot to await" mistake).
 */
export const PROMISE_HINT = 'Promise rejected; did you forget await?'

/**
 * Depth cap for the recursive promise-rejection-reason formatter
 * (`formatPromise` → `toErrorItem` → `formatPromise`). `Promise.reject(x)` does
 * not unwrap `x`, so a self-rejected or cyclic promise would otherwise recurse
 * until the host worker stack overflows — which both breaks the "run never
 * throws" invariant and can abort the VM on teardown. Past this many nested
 * rejected promises the reason renders as a bounded `[nested promise]` marker.
 */
const MAX_PROMISE_DEPTH = 8

/**
 * Output accumulator shared by console / display capture and the result
 * push. Tracks the cumulative byte size so the kernel can abort a run that
 * blows past the output budget *while it is still producing output* — the
 * host-side check only sees data after the run finishes.
 */
interface Sink {
  items: OutputItem[]
  bytes: number
  /** Number of items accepted so far this run (capped by OUTPUT_ITEM_LIMIT). */
  count: number
  budgetHit: boolean
  /**
   * Set by the injected `__nbTrailing` marker when this run's trailing
   * expression evaluated to a Promise. Read on the rejection branch to attach
   * the "did you forget await?" hint, distinguishing a rejected trailing
   * Promise from an ordinary throw (both reach `awaited.error`). Reset per run.
   */
  trailingWasPromise: boolean
  /**
   * Optional per-run streaming hook. Invoked synchronously the moment an item
   * is accepted into `items`, so the worker can post it to the host BEFORE the
   * run finishes (true incremental output) instead of replaying the whole
   * batch at the end. Rebound per run; `undefined` means "buffer only".
   */
  emit?: (item: OutputItem) => void
}

/**
 * Append an item unless the per-run output budget is already exhausted. On
 * the first overflow it records a single truncation marker and flips
 * `budgetHit`, which the interrupt handler reads to abort the run. Every
 * accepted item (including the truncation marker) is also streamed through
 * `sink.emit` so the host sees output as it is produced.
 */
function pushItem(sink: Sink, item: OutputItem): void {
  if (sink.budgetHit) return
  const size = measureItemBytes(item)
  // Two independent caps: cumulative bytes AND item count. The byte cap stops
  // a few huge strings; the count cap stops a runaway loop of tiny/empty logs
  // (each 0–1 bytes) that would never trip the byte budget but still floods
  // the message channel and the UI. Either overflow truncates once.
  if (sink.bytes + size > OUTPUT_BUDGET_BYTES || sink.count + 1 > OUTPUT_ITEM_LIMIT) {
    sink.budgetHit = true
    const reason =
      sink.count + 1 > OUTPUT_ITEM_LIMIT
        ? `Output truncated at ${OUTPUT_ITEM_LIMIT} items`
        : `Output truncated at ${OUTPUT_BUDGET_BYTES} bytes`
    const marker: OutputItem = { type: 'stderr', text: reason }
    sink.items.push(marker)
    sink.emit?.(marker)
    return
  }
  sink.bytes += size
  sink.count += 1
  sink.items.push(item)
  sink.emit?.(item)
}

export interface RuntimeOptions {
  /** Hard upper bound for execution time, in ms. Default 30_000. */
  timeoutMs?: number
  /**
   * Streaming hook: called once per output item as it is produced, before the
   * run resolves. The same items are still returned in the final result.
   */
  onItem?: (item: OutputItem) => void
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
  // Cap the runtime's resources, set once before any eval. These are blunt
  // backstops against an OOM / deep-recursion run taking the worker (and the
  // tab) down before the timeout fires; CPU/infinite-loop protection is the
  // interrupt handler's job, not these. The limit lives on the persistent
  // runtime, so it bounds the SHARED scope's lifetime growth too — kept
  // generous so an ordinary multi-cell notebook never hits it.
  vm.runtime.setMemoryLimit(VM_MEMORY_LIMIT_BYTES)
  vm.runtime.setMaxStackSize(VM_MAX_STACK_BYTES)
  // Items array is rebound per-run, but console / display capture it via
  // this mutable ref so we only have to install them once.
  const sink: Sink = { items: [], bytes: 0, count: 0, budgetHit: false, trailingWasPromise: false }
  // The base64/codec/structuredClone installers eval in-VM bootstrap strings and
  // THROW if any fails to install. Dispose the freshly allocated context before
  // re-throwing, otherwise a bootstrap failure leaks the WASM QuickJSContext on
  // this (loud) error path (TARDIS-168).
  try {
    installConsole(vm, sink)
    installDisplay(vm, sink)
    installBase64(vm)
    installTextCodecs(vm)
    installStructuredClone(vm)
    installTrailingMarker(vm, sink)
  } catch (e) {
    vm.dispose()
    throw e
  }

  return {
    async run(code, runOptions = {}): Promise<RuntimeResult> {
      return runOne(
        vm,
        sink,
        code,
        runOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.shouldInterrupt,
        runOptions.onItem,
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
  onItem?: (item: OutputItem) => void,
): Promise<RuntimeResult> {
  const items: OutputItem[] = []
  sink.items = items
  sink.bytes = 0
  sink.count = 0
  sink.budgetHit = false
  sink.trailingWasPromise = false
  // Bind the streaming hook for this run so every pushItem also forwards the
  // item to the host immediately. Rebound on each run (undefined clears it),
  // and pushItem only fires while VM code executes — between runs nothing
  // touches the sink, so no stale emit can leak across runs.
  sink.emit = onItem

  // 1) AST transform: publish top-level declarations to globalThis + return
  //    the trailing expression (if any). Reject import/export early with a
  //    readable SyntaxError. Route it through pushItem so it streams like any
  //    other item (the worker no longer replays a final batch).
  let transformed: string
  try {
    transformed = transformCellCode(code).code
  } catch (err) {
    pushItem(sink, {
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
        // A rejected trailing Promise and an ordinary throw both land here; the
        // `__nbTrailing` marker tells them apart so the hint targets only the
        // former. `pushAbortAware` runs makeItem only when cause === 'none'.
        pushAbortAware(sink, abort.cause, () => {
          const item = toErrorItem(vm, awaited.error)
          if (sink.trailingWasPromise) item.hint = PROMISE_HINT
          return item
        })
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
    // Clear the streaming hook so it cannot fire between runs. Safe today
    // (pushItem only runs during VM execution), but defends against a future
    // change that schedules a microtask after the run resolves.
    sink.emit = undefined
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

// `display()` types that are really just HTML content and render in the html
// iframe. The canonical one is `html`; `canvas`/`svg` are common model slips.
const HTML_DISPLAY_TYPES = new Set(['html', 'canvas', 'svg'])

function displayPayloadToItem(payload: unknown): OutputItem | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as {
    type?: unknown
    value?: unknown
    html?: unknown
    mime?: unknown
    data?: unknown
  }
  // Canonical form is { type: 'html', value }. Models routinely emit near-miss
  // variants the contract never had: a made-up `type` that is really just HTML
  // (`canvas`, `svg`) and/or an `html` field instead of `value`. SVG/canvas are
  // plain HTML content and render fine in the html iframe, so map these onto the
  // html case — a one-field slip renders instead of silently dropping the output
  // (TARDIS-168). The prompt still teaches the single canonical form.
  if (typeof p.type === 'string' && HTML_DISPLAY_TYPES.has(p.type)) {
    const html = typeof p.value === 'string' ? p.value : typeof p.html === 'string' ? p.html : null
    if (html !== null) return { type: 'html', html }
  }
  if (p.type === 'image' && typeof p.mime === 'string' && typeof p.data === 'string') {
    // Only well-known image MIME types are allowed — `<img>` shouldn't
    // receive arbitrary user-controlled MIME strings.
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(p.mime)) return null
    return { type: 'image', mime: p.mime, data: p.data }
  }
  return null
}

/**
 * Inject the browser base64 helpers `btoa` / `atob` into cell scope.
 *
 * QuickJS is a bare ECMAScript engine — it ships none of the Web platform
 * globals, so a cell sees `typeof btoa === 'undefined'`. Yet these are pure,
 * side-effect-free string⇄base64 codecs: no network, no DOM, no filesystem, so
 * nothing about the sandbox boundary justifies withholding them. Their absence
 * was a missing polyfill, not a security decision.
 *
 * Implemented as a pure-JS polyfill EVALUATED INSIDE the VM, deliberately NOT
 * as a host function delegating to the worker's native `btoa`/`atob`. `atob`
 * returns a *binary string* whose bytes routinely include NUL (`\x00`) — e.g.
 * decoding a PNG — and such strings are corrupted when marshalled across the
 * quickjs-emscripten string boundary (`newString`/`dump`). Keeping the codec
 * in-VM means the strings never cross that boundary, so the round-trip stays
 * byte-exact. The polyfill preserves the browser error contract: `btoa` throws
 * on any code point > 0xFF, `atob` on an invalid-length / out-of-alphabet input.
 */
function installBase64(vm: QuickJSContext): void {
  evalBootstrap(vm, 'base64', BASE64_BOOTSTRAP)
}

/**
 * Evaluate a trusted bootstrap snippet in cell scope, disposing the handles and
 * turning any (host-authored) error into a thrown Error. Used to install the
 * pure-JS Web platform polyfills (`btoa`/`atob`, text codecs, structuredClone)
 * once per kernel — see each `*_BOOTSTRAP` for why they live in-VM.
 */
function evalBootstrap(vm: QuickJSContext, label: string, code: string): void {
  const result = vm.evalCode(code)
  if (result.error) {
    const message = vm.dump(result.error) as unknown
    result.error.dispose()
    throw new Error(`failed to install ${label} polyfill: ${String(message)}`)
  }
  result.value.dispose()
}

/**
 * Defines `globalThis.btoa` / `globalThis.atob` with WHATWG semantics, entirely
 * in cell scope. Kept as a string so the codec executes in-VM (see
 * `installBase64` for why crossing the host boundary would corrupt binary
 * strings). Plain writable globals — like the browser's, a cell may shadow them.
 */
const BASE64_BOOTSTRAP = `(() => {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const LATIN1_RANGE_ERROR =
    "Failed to execute 'btoa': The string to be encoded contains characters outside of the Latin1 range."
  const DECODE_ERROR = "Failed to execute 'atob': The string to be decoded is not correctly encoded."
  // The platform throws a DOMException named 'InvalidCharacterError'. QuickJS has
  // no DOMException, so we approximate it with the same \`.name\` — enough for a
  // cell branching on \`e.name\`; \`instanceof DOMException\` cannot be reproduced.
  const invalidChar = (message) => {
    const e = new Error(message)
    e.name = 'InvalidCharacterError'
    return e
  }

  globalThis.btoa = function btoa(data) {
    const str = String(data)
    let out = ''
    for (let i = 0; i < str.length; i += 3) {
      const hasC2 = i + 1 < str.length
      const hasC3 = i + 2 < str.length
      const c1 = str.charCodeAt(i)
      const c2 = hasC2 ? str.charCodeAt(i + 1) : 0
      const c3 = hasC3 ? str.charCodeAt(i + 2) : 0
      if (c1 > 0xff || c2 > 0xff || c3 > 0xff) throw invalidChar(LATIN1_RANGE_ERROR)
      const triple = (c1 << 16) | (c2 << 8) | c3
      out += ALPHABET[(triple >> 18) & 63]
      out += ALPHABET[(triple >> 12) & 63]
      out += hasC2 ? ALPHABET[(triple >> 6) & 63] : '='
      out += hasC3 ? ALPHABET[triple & 63] : '='
    }
    return out
  }

  globalThis.atob = function atob(data) {
    // WHATWG forgiving-base64 decode: strip ASCII whitespace, remove up to two
    // trailing '=' ONLY when the length is a multiple of 4, then reject a
    // remainder of 1 and any remaining non-alphabet character (so a '=' in the
    // middle fails, instead of silently truncating the result).
    let str = String(data).replace(/[ \\t\\n\\f\\r]/g, '')
    if (str.length % 4 === 0) str = str.replace(/={1,2}$/, '')
    if (str.length % 4 === 1) throw invalidChar(DECODE_ERROR)
    let out = ''
    let buffer = 0
    let bits = 0
    for (let i = 0; i < str.length; i++) {
      const idx = ALPHABET.indexOf(str[i])
      if (idx === -1) throw invalidChar(DECODE_ERROR)
      buffer = (buffer << 6) | idx
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out += String.fromCharCode((buffer >> bits) & 0xff)
      }
    }
    return out
  }
})()`

/**
 * Inject the UTF-8 `TextEncoder` / `TextDecoder` into cell scope.
 *
 * Same rationale as `installBase64`: pure, side-effect-free codecs that QuickJS
 * (a bare ECMAScript engine) doesn't ship. Evaluated in-VM rather than bridged
 * to the worker's native classes — a host bridge would have to marshal raw bytes
 * AND binary strings across the quickjs-emscripten boundary (lossy for NUL), and
 * would expose host object identities. The polyfill builds real in-VM
 * `Uint8Array`s and covers the surrogate-pair / replacement-char edge cases.
 */
function installTextCodecs(vm: QuickJSContext): void {
  evalBootstrap(vm, 'TextEncoder/TextDecoder', TEXT_CODECS_BOOTSTRAP)
}

/**
 * Inject a `structuredClone` deep-copy into cell scope.
 *
 * Pure and side-effect-free, so it belongs in the sandbox. Done in-VM so clones
 * are genuine in-VM objects (a host bridge would round-trip through `dump`, which
 * can't preserve cycles, Map/Set, typed arrays or ArrayBuffers). Covers the
 * common structured-clone types and throws on values that can't be cloned
 * (functions / symbols), mirroring the platform's DataCloneError.
 */
function installStructuredClone(vm: QuickJSContext): void {
  evalBootstrap(vm, 'structuredClone', STRUCTURED_CLONE_BOOTSTRAP)
}

/**
 * Defines `globalThis.TextEncoder` / `globalThis.TextDecoder` (UTF-8 only) in
 * cell scope. Kept as a string so the codec runs in-VM (see `installTextCodecs`).
 * Unpaired surrogates encode as U+FFFD and malformed byte sequences decode to
 * U+FFFD, matching the WHATWG Encoding standard's replacement behavior.
 */
const TEXT_CODECS_BOOTSTRAP = `(() => {
  globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8' }
    encode(input) {
      const str = input === undefined ? '' : String(input)
      const bytes = []
      for (let i = 0; i < str.length; i++) {
        let cp = str.charCodeAt(i)
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
          const lo = str.charCodeAt(i + 1)
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00)
            i++
          }
        }
        if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
        if (cp < 0x80) {
          bytes.push(cp)
        } else if (cp < 0x800) {
          bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
        } else if (cp < 0x10000) {
          bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        } else {
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f),
          )
        }
      }
      return new Uint8Array(bytes)
    }
  }

  globalThis.TextDecoder = class TextDecoder {
    constructor(label) {
      const enc = label === undefined ? 'utf-8' : String(label).toLowerCase()
      if (enc !== 'utf-8' && enc !== 'utf8' && enc !== 'unicode-1-1-utf-8') {
        throw new RangeError("Failed to construct 'TextDecoder': unsupported encoding " + enc)
      }
    }
    get encoding() { return 'utf-8' }
    decode(input) {
      if (input === undefined) return ''
      let bytes
      if (input instanceof Uint8Array) bytes = input
      else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input)
      else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      else throw new TypeError("Failed to execute 'decode' on 'TextDecoder': argument is not a BufferSource")
      let out = ''
      let i = 0
      while (i < bytes.length) {
        const b0 = bytes[i++]
        let cp, extra, min
        if (b0 < 0x80) { out += String.fromCharCode(b0); continue }
        // 'min' is the smallest code point this byte-length may legitimately
        // encode; anything below it is an OVERLONG form and must be rejected
        // (TARDIS-168 M3, WHATWG UTF-8). A 0xC0/0xC1 lead byte yields min 0x80
        // with a value below it, so it is rejected by the min check downstream.
        else if ((b0 & 0xe0) === 0xc0) { cp = b0 & 0x1f; extra = 1; min = 0x80 }
        else if ((b0 & 0xf0) === 0xe0) { cp = b0 & 0x0f; extra = 2; min = 0x800 }
        else if ((b0 & 0xf8) === 0xf0) { cp = b0 & 0x07; extra = 3; min = 0x10000 }
        else { out += '\ufffd'; continue }
        let ok = true
        for (let k = 0; k < extra; k++) {
          if (i >= bytes.length || (bytes[i] & 0xc0) !== 0x80) { ok = false; break }
          cp = (cp << 6) | (bytes[i] & 0x3f)
          i++
        }
        // Reject (to U+FFFD): truncated continuation, overlong encoding, the
        // lone-surrogate range (0xD800-0xDFFF), and anything past U+10FFFF.
        if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          out += '\ufffd'; continue
        }
        if (cp >= 0x10000) {
          cp -= 0x10000
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        } else {
          out += String.fromCharCode(cp)
        }
      }
      return out
    }
  }
})()`

/**
 * Defines `globalThis.structuredClone` in cell scope. Kept as a string so the
 * clone runs in-VM (see `installStructuredClone`). Handles cycles, the common
 * cloneable types (Array / Map / Set / Date / RegExp / ArrayBuffer + views) and
 * Error objects; throws on functions / symbols.
 *
 * Deliberate deviations from the platform (acceptable for the notebook sandbox):
 *  - the thrown value is a plain Error whose `.name` is 'DataCloneError' (QuickJS
 *    has no DOMException, so a cell can match on `e.name` but not
 *    `instanceof DOMException`);
 *  - host-only types absent from the VM (Blob / File / ImageData) do not exist
 *    here, so any unrecognised object is cloned as a plain `{}` of its OWN
 *    ENUMERABLE keys;
 *  - ArrayBuffer / typed-array views are NOT registered in `seen`, so two views
 *    onto the SAME buffer clone to two independent buffers (the platform keeps
 *    them aliased). Edge fidelity only — not worth the extra bookkeeping here;
 *  - `AggregateError` is not in ERROR_CTORS, so it flattens to `Error` and drops
 *    `.errors`.
 */
const STRUCTURED_CLONE_BOOTSTRAP = `(() => {
  const UNCLONEABLE = "Failed to execute 'structuredClone': value could not be cloned."
  const ERROR_CTORS = { Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError }
  globalThis.structuredClone = function structuredClone(value) {
    const seen = new Map()
    function clone(v) {
      if (typeof v === 'function' || typeof v === 'symbol') {
        const e = new Error(UNCLONEABLE)
        e.name = 'DataCloneError'
        throw e
      }
      if (v === null || typeof v !== 'object') return v
      if (seen.has(v)) return seen.get(v)
      if (v instanceof Date) return new Date(v.getTime())
      if (v instanceof RegExp) return new RegExp(v.source, v.flags)
      if (v instanceof ArrayBuffer) return v.slice(0)
      if (ArrayBuffer.isView(v)) {
        const buf = v.buffer.slice(0)
        if (v instanceof DataView) return new DataView(buf, v.byteOffset, v.byteLength)
        return new v.constructor(buf, v.byteOffset, v.length)
      }
      if (v instanceof Error) {
        // The platform preserves name/message/stack/cause (all non-enumerable,
        // so Object.keys would drop them); copy them explicitly, then any extra
        // own enumerable props the loop below adds.
        const Ctor = ERROR_CTORS[v.name] || Error
        const out = new Ctor(v.message)
        seen.set(v, out)
        if (v.stack !== undefined) out.stack = v.stack
        if ('cause' in v) out.cause = clone(v.cause)
        for (const key of Object.keys(v)) out[key] = clone(v[key])
        return out
      }
      let out
      if (Array.isArray(v)) {
        out = []
        seen.set(v, out)
        for (let i = 0; i < v.length; i++) out[i] = clone(v[i])
        return out
      }
      if (v instanceof Map) {
        out = new Map()
        seen.set(v, out)
        v.forEach((val, key) => out.set(clone(key), clone(val)))
        return out
      }
      if (v instanceof Set) {
        out = new Set()
        seen.set(v, out)
        v.forEach((val) => out.add(clone(val)))
        return out
      }
      out = {}
      seen.set(v, out)
      for (const key of Object.keys(v)) out[key] = clone(v[key])
      return out
    }
    return clone(value)
  }
})()`

/**
 * Inject `__nbTrailing(v)` — an identity function the transform wraps around a
 * cell's trailing expression. It records (in `sink.trailingWasPromise`) whether
 * `v` is a Promise, then returns `v` unchanged so the async IIFE still adopts
 * (auto-awaits) it. The flag lets the kernel attach the "did you forget await?"
 * hint when that trailing Promise rejects, without tagging ordinary throws.
 *
 * Returning the borrowed argument handle is safe here — quickjs-emscripten's
 * `newFunction` copies the callback's return value into the VM before freeing
 * the argument handles. Promise detection and its handle-disposal contract live
 * in `isPromise`/`inspectPromise`.
 *
 * Defined read-only / non-configurable / non-enumerable: user declarations
 * publish to the same `globalThis` (and the VM is persistent), so a plain
 * writable prop could be reassigned or deleted from a cell and silently break
 * trailing detection for the rest of the session. Read-only comes from the
 * VALUE descriptor itself — a QuickJS value property with no get/set defaults to
 * non-writable (so `globalThis.<m> = …` is ignored in sloppy mode, throws in
 * strict). `configurable: false` is a SEPARATE guarantee: it blocks redefining
 * or deleting the marker, NOT reassignment. Non-enumerable keeps it out of the
 * user's `Object.keys(globalThis)`.
 *
 * `__nbTrailing` is internal: the transform only emits it around the trailing
 * expression. A cell that *directly* calls this hidden marker with a Promise and
 * then throws can set a misleading hint — an accepted cosmetic edge, not part of
 * the user API (the marker is non-enumerable and `__nb`-prefixed).
 */
function installTrailingMarker(vm: QuickJSContext, sink: Sink): void {
  const fn = vm.newFunction(TRAILING_MARKER, (handle) => {
    if (isPromise(vm, handle)) sink.trailingWasPromise = true
    return handle
  })
  // Read-only is the QuickJS default for a value descriptor; `VmPropertyDescriptor`
  // has no `writable` key, so it can't (and must not) be flipped writable here.
  vm.defineProp(vm.global, TRAILING_MARKER, { value: fn, configurable: false, enumerable: false })
  fn.dispose()
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
function toErrorItem(
  vm: QuickJSContext,
  errorHandle: QuickJSHandle,
  depth = 0,
): Extract<OutputItem, { type: 'error' }> {
  // A rejection reason can itself be a Promise — `Promise.reject(x)` does NOT
  // unwrap x. `vm.dump` on a Promise both LEAKS its internal state object
  // (`{"type":"rejected",...}`) into the message AND disposes the handle, which
  // the caller then disposes again → double-free (TARDIS-65 H-1). Render it
  // promise-aware first; `formatPromise` never dumps or disposes `errorHandle`.
  // `depth` is threaded so the formatPromise↔toErrorItem recursion stays bounded.
  const asPromise = formatPromise(vm, errorHandle, depth)
  if (asPromise !== null) {
    // `name` is intentionally generic here: a Promise reason has no Error class;
    // the rendered `message` (`Promise { … }`) carries the actual information.
    return { type: 'error', name: 'Error', message: asPromise }
  }
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
 * Inspect a handle's Promise state and hand the result to exactly one callback,
 * owning the handle-disposal contract in ONE place so it cannot drift between
 * call sites. Disposal follows the `JSPromiseState` contract in
 * quickjs-emscripten's types (`getPromiseState` is used instead of `vm.dump`,
 * which on a Promise both leaks its internal state and disposes the handle):
 *   - non-Promise → `onNotPromise()`; the fulfilled state carries
 *     `notAPromise: true` and its `value` IS the borrowed input handle (per the
 *     type's own doc comment) — NOT disposed here.
 *   - pending     → `onPending()`; no disposable handles (`error` is a throwing
 *     getter, never read).
 *   - fulfilled   → `onFulfilled(value)`; `value` is a fresh dup — disposed
 *     after the callback returns.
 *   - rejected    → `onRejected(error)`; `error` is a fresh dup — disposed after
 *     the callback returns.
 * Callbacks must read the handle synchronously and not retain it.
 */
function inspectPromise<T>(
  vm: QuickJSContext,
  handle: QuickJSHandle,
  handlers: {
    onNotPromise: () => T
    onPending: () => T
    onFulfilled: (value: QuickJSHandle) => T
    onRejected: (error: QuickJSHandle) => T
  },
): T {
  let state: ReturnType<QuickJSContext['getPromiseState']>
  try {
    state = vm.getPromiseState(handle)
  } catch {
    return handlers.onNotPromise()
  }
  if (state.type === 'fulfilled' && state.notAPromise) return handlers.onNotPromise()
  switch (state.type) {
    case 'pending':
      return handlers.onPending()
    case 'fulfilled':
      try {
        return handlers.onFulfilled(state.value)
      } finally {
        state.value.dispose()
      }
    case 'rejected':
      try {
        return handlers.onRejected(state.error)
      } finally {
        state.error.dispose()
      }
  }
}

/** True if the handle is a Promise (any state), with correct disposal. */
function isPromise(vm: QuickJSContext, handle: QuickJSHandle): boolean {
  return inspectPromise(vm, handle, {
    onNotPromise: () => false,
    onPending: () => true,
    onFulfilled: () => true,
    onRejected: () => true,
  })
}

/**
 * Render a QuickJS Promise handle Node-style (`Promise { <pending> }`,
 * `Promise { 42 }`, `Promise { <rejected> TypeError: ... }`), or return null if
 * the handle is not a Promise. Goes through `inspectPromise` (`getPromiseState`),
 * never `vm.dump`, which leaks the engine's internal state object and disposes
 * the handle.
 */
function formatPromise(vm: QuickJSContext, handle: QuickJSHandle, depth = 0): string | null {
  // Cheap gate: only objects can be Promises. Skips the `getPromiseState`
  // round-trip (a WASM call + allocation) for primitives on the hot console path.
  if (vm.typeof(handle) !== 'object') return null
  return inspectPromise<string | null>(vm, handle, {
    onNotPromise: () => null,
    onPending: () => 'Promise { <pending> }',
    onFulfilled: (value) => `Promise { ${stringifyArg(vm, value)} }`,
    onRejected: (error) => {
      // Bound the formatPromise → toErrorItem → formatPromise recursion: a
      // self-rejected or cyclic promise (`Promise.reject(x)` does not unwrap x)
      // would otherwise overflow the host worker stack. Past the cap, stop and
      // render a bounded marker instead of recursing into the reason.
      if (depth >= MAX_PROMISE_DEPTH) return 'Promise { <rejected> [nested promise] }'
      // The reason is usually an Error, but it can be a Promise (rendered
      // promise-aware by toErrorItem, which never dumps/disposes a Promise
      // reason) or any other value.
      const err = toErrorItem(vm, error, depth + 1)
      return `Promise { <rejected> ${err.name}: ${err.message} }`
    },
  })
}

/**
 * Stringify a single console.log argument. The argument handle is borrowed
 * from quickjs-emscripten; do NOT dispose it here.
 */
function stringifyArg(vm: QuickJSContext, handle: QuickJSHandle): string {
  // Promise-aware FIRST: a bare `vm.dump` of a Promise leaks the engine's
  // internal `{"type":"rejected"|"fulfilled"|"pending",...}` state object.
  const asPromise = formatPromise(vm, handle)
  if (asPromise !== null) return asPromise

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
