import { afterEach, describe, expect, test } from 'vitest'
import { restartWorker, runInWorker } from './workerHost'

// All worker tests share a single worker instance (singleton inside
// workerHost). To keep them independent we restart between cases.
afterEach(() => {
  restartWorker()
})

describe('runInWorker — basic round trip', () => {
  test('returns done with stdout for a successful run', async () => {
    const r = await runInWorker('console.log("hello")')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'hello' })
  })

  test('propagates errors as error item with status=error', async () => {
    const r = await runInWorker('throw new Error("boom from worker")')
    expect(r.status).toBe('error')
    const err = r.items.find((it) => it.type === 'error')
    expect(err).toBeDefined()
    if (err?.type === 'error') expect(err.message).toBe('boom from worker')
  })

  test('isolation holds inside worker too', async () => {
    const r = await runInWorker(
      'console.log(typeof window, typeof document, typeof fetch, typeof localStorage)',
    )
    expect(r.items).toContainEqual({
      type: 'stdout',
      text: 'undefined undefined undefined undefined',
    })
  })
})

describe('runInWorker — timeout and respawn', () => {
  test('infinite loop is stopped within the host deadline', async () => {
    const start = Date.now()
    const r = await runInWorker('while(true){}', undefined, { timeoutMs: 200 })
    const elapsed = Date.now() - start
    expect(r.status).toBe('timeout')
    // Either an in-VM interrupt (error item) or a host-side terminate
    // (stderr item) is acceptable — both prove the loop was stopped.
    expect(r.items.some((it) => it.type === 'stderr' || it.type === 'error')).toBe(true)
    expect(elapsed).toBeLessThan(700)
  }, 3000)

  test('next call after a timeout still works (worker respawns)', async () => {
    await runInWorker('while(true){}', undefined, { timeoutMs: 150 })
    const r = await runInWorker('console.log(42)')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: '42' })
  }, 5000)
})

describe('runInWorker — serialisation', () => {
  test('two parallel calls run sequentially in submission order', async () => {
    // Calls in flight at the same time; expect results in submission order.
    const a = runInWorker('console.log("first")')
    const b = runInWorker('console.log("second")')
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.items).toContainEqual({ type: 'stdout', text: 'first' })
    expect(rb.items).toContainEqual({ type: 'stdout', text: 'second' })
  })
})

describe('runInWorker — shared scope across runs', () => {
  test('const from run A is visible in run B', async () => {
    const a = await runInWorker('const x = 7')
    const b = await runInWorker('console.log(x)', a.scope)
    expect(b.items).toContainEqual({ type: 'stdout', text: '7' })
  })

  test('input scope round-trips when run does not modify it', async () => {
    const r = await runInWorker('1', { x: 'keep' })
    expect(r.scope).toEqual({ x: 'keep' })
  })

  test('restartWorker after assigning a var clears scope on next run', async () => {
    const a = await runInWorker('const dropMe = 1')
    // Restart the worker as if Restart Kernel was hit; pass empty scope.
    restartWorker()
    const b = await runInWorker('console.log(typeof dropMe)', {})
    expect(b.items).toContainEqual({ type: 'stdout', text: 'undefined' })
    // sanity: scope from `a` is unrelated to `b` here
    expect(a.scope).toEqual({ dropMe: 1 })
  })
})
