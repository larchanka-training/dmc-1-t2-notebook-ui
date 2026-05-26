// Worker-side interrupt flag backed by a SharedArrayBuffer.
//
// The host writes a non-zero value into slot 0 when the user presses Stop.
// Because the buffer is *shared*, the write is visible to this worker even
// while its thread is blocked in a tight loop — the QuickJS interrupt
// handler reads the flag between bytecode ops and aborts the evaluation.
//
// This is the only reliable way to interrupt a synchronous infinite loop
// without `worker.terminate()` (which would also destroy the persistent VM
// and lose the shared scope). It requires a cross-origin isolated context;
// when that is unavailable the host falls back to terminating the worker.

let flag: Int32Array | null = null

/** Install the shared buffer. Called once on the worker `init` message. */
export function setInterruptBuffer(buffer: SharedArrayBuffer): void {
  flag = new Int32Array(buffer)
}

/** True when the host has requested an interrupt and it hasn't been cleared. */
export function isInterruptRequested(): boolean {
  return flag !== null && Atomics.load(flag, 0) !== 0
}
