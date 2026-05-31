// Shared output-budget accounting for the execution runtime.
//
// Lives in its own tiny module because BOTH sides need it but must not import
// each other:
//   - the kernel (quickjs.ts, runs inside the worker) enforces the budget
//     while user code executes, so a runaway `for(;;) console.log(...)` cannot
//     grow the worker's memory without bound;
//   - the host facade (workerHost.ts) keeps a defense-in-depth check on the
//     items it receives (covers an injected/fake worker that bypasses the
//     kernel).
//
// workerHost.ts must never import quickjs.ts (that would pull the QuickJS WASM
// into the main-thread bundle), hence this neutral module.

import type { OutputItem } from './types'

/** Cumulative output size cap per run. ~Jupyter's default. */
export const OUTPUT_BUDGET_BYTES = 5 * 1024 * 1024

/**
 * Cap on the NUMBER of output items per run, independent of their byte size.
 * The byte budget alone does not stop a runaway loop of empty or 1-char logs
 * (`for(;;) console.log('')` is 0 bytes each), which would still flood the
 * worker→host message channel and the UI atom with millions of items. This
 * limit is the real backstop against item-count runaway; 10k is generous for
 * a teaching notebook yet bounds memory and render pressure.
 */
export const OUTPUT_ITEM_LIMIT = 10_000

// Reused across calls; available in both Worker and jsdom contexts.
const encoder = new TextEncoder()

/** UTF-8 byte length of a string (so the "bytes" budget is honest about
 *  multibyte characters, not UTF-16 code units). */
function byteLength(text: string): number {
  return encoder.encode(text).length
}

/**
 * Byte size of a single output item. Used to enforce the cumulative output
 * budget; counts UTF-8 bytes so the truncation marker's "<N> bytes" is
 * accurate.
 */
export function measureItemBytes(item: OutputItem): number {
  switch (item.type) {
    case 'stdout':
    case 'stderr':
      return byteLength(item.text)
    case 'error':
      return byteLength(item.name) + byteLength(item.message) + byteLength(item.stack ?? '')
    case 'result':
      try {
        return byteLength(JSON.stringify(item.value))
      } catch {
        return 0
      }
    case 'html':
      return byteLength(item.html)
    case 'image':
      return byteLength(item.data) + byteLength(item.mime)
  }
}
