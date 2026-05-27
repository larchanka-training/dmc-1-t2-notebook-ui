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
 * Rough byte size of a single output item. An order-of-magnitude estimate is
 * enough to stop a runaway output loop before it OOMs; precision is not the
 * goal here.
 */
export function measureItemBytes(item: OutputItem): number {
  switch (item.type) {
    case 'stdout':
    case 'stderr':
      return item.text.length
    case 'error':
      return item.name.length + item.message.length + (item.stack?.length ?? 0)
    case 'result':
      try {
        return JSON.stringify(item.value).length
      } catch {
        return 0
      }
    case 'html':
      return item.html.length
    case 'image':
      return item.data.length + item.mime.length
  }
}
