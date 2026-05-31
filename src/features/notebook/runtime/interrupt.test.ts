import { describe, expect, test } from 'vitest'
import { isInterruptRequested, setInterruptBuffer } from './interrupt'

// The module holds a single module-level flag, so these assertions run in
// sequence within one test to keep the shared state deterministic.
describe('interrupt flag (SharedArrayBuffer-backed)', () => {
  test('reports false before a buffer is installed, then mirrors the shared int32', () => {
    // Fresh module state in this file: no buffer installed yet.
    expect(isInterruptRequested()).toBe(false)

    const buffer = new SharedArrayBuffer(4)
    const view = new Int32Array(buffer)
    setInterruptBuffer(buffer)

    // Slot 0 starts at zero => no interrupt requested.
    expect(isInterruptRequested()).toBe(false)

    // Host sets the flag => requested.
    Atomics.store(view, 0, 1)
    expect(isInterruptRequested()).toBe(true)

    // Host clears it (done before each run) => back to not-requested.
    Atomics.store(view, 0, 0)
    expect(isInterruptRequested()).toBe(false)
  })
})
