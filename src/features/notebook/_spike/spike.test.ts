// SPIKE — TARDIS-70. Vitest smoke checks.
import { describe, expect, test } from 'vitest'
import { runSmoke } from './quickjs-smoke'
import { runInSpikeWorker } from './spike-host'

describe('QuickJS standalone (no Worker)', () => {
  test('1+1 via console.log → 2', async () => {
    const r = await runSmoke('console.log(1 + 1)')
    expect(r.ok).toBe(true)
    expect(r.output).toBe('2')
  })

  test('sandbox isolation: all four host APIs are undefined inside QuickJS', async () => {
    const r = await runSmoke('console.log("noop")')
    expect(r.isolation.window).toBe('undefined')
    expect(r.isolation.document).toBe('undefined')
    expect(r.isolation.fetch).toBe('undefined')
    expect(r.isolation.localStorage).toBe('undefined')
  })

  test('infinite loop is interrupted by setInterruptHandler (deadline)', async () => {
    const start = Date.now()
    const r = await runSmoke('while(true){}', 200)
    const elapsed = Date.now() - start
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/interrupt/i)
    // sanity: interrupt fires soon after deadline, well before any sane test timeout
    expect(elapsed).toBeLessThan(1000)
  })

  test('top-level await works', async () => {
    const r = await runSmoke('const x = await Promise.resolve(42); console.log(x)')
    expect(r.ok).toBe(true)
    expect(r.output).toBe('42')
  })

  test('thrown Error → ok=false, message in output', async () => {
    const r = await runSmoke('throw new Error("boom")')
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/boom/)
  })
})

describe('QuickJS inside Web Worker', () => {
  test('1+1 via console.log → 2 (through worker)', async () => {
    const r = await runInSpikeWorker('console.log(1 + 1)')
    expect(r.ok).toBe(true)
    expect(r.output).toBe('2')
  })

  test('isolation holds inside worker too', async () => {
    const r = await runInSpikeWorker('console.log("noop")')
    expect(r.isolation.window).toBe('undefined')
    expect(r.isolation.document).toBe('undefined')
    expect(r.isolation.fetch).toBe('undefined')
    expect(r.isolation.localStorage).toBe('undefined')
  })

  test('infinite loop is stopped within the deadline (interrupt OR terminate)', async () => {
    // Two paths exist and both are acceptable: QuickJS in-VM interrupt or
    // host-side worker.terminate(). What matters for AC #4 is the loop
    // doesn't hang past the deadline.
    const timeoutMs = 200
    const start = Date.now()
    const r = await runInSpikeWorker('while(true){}', timeoutMs)
    const elapsed = Date.now() - start
    expect(r.ok).toBe(false)
    expect(elapsed).toBeLessThan(timeoutMs + 500)
  }, 3000)

  test('worker respawns after timeout — next call works', async () => {
    await runInSpikeWorker('while(true){}', 200)
    const r = await runInSpikeWorker('console.log(42)')
    expect(r.ok).toBe(true)
    expect(r.output).toBe('42')
  }, 5000)

  test('top-level await works through worker', async () => {
    const r = await runInSpikeWorker('const x = await Promise.resolve(7); console.log(x)')
    expect(r.ok).toBe(true)
    expect(r.output).toBe('7')
  })

  test('thrown Error through worker → ok=false, message in output', async () => {
    const r = await runInSpikeWorker('throw new Error("boom")')
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/boom/)
  })
})
