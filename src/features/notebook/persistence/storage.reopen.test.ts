// Regression: a failed initial DB open must not be cached.
//
// `getDB()` memoises the `openDB` promise. If the very first open rejects
// (blocked DB, private mode), a cached rejection would make every later call —
// including the "Save failed — retry" affordance — reuse the failure and never
// reopen. The fix clears the cache on a rejected open; this test locks it in.
//
// The db promise is a module-level singleton, so we isolate the module
// (`resetModules`) and mock `idb` to reject only the first open.
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('idb')
  vi.resetModules()
})

describe('notebook storage — reopen after failed open', () => {
  test('retries the open instead of reusing a cached rejection', async () => {
    vi.resetModules()
    let openCalls = 0
    vi.doMock('idb', async () => {
      const actual = await vi.importActual<typeof import('idb')>('idb')
      return {
        ...actual,
        openDB: (...args: Parameters<typeof actual.openDB>) => {
          openCalls += 1
          if (openCalls === 1) return Promise.reject(new Error('blocked'))
          return actual.openDB(...args)
        },
      }
    })

    const storage = await import('./storage')
    await expect(storage.get('any')).rejects.toThrow('blocked')
    // Second call must retry the open, not reuse the rejected promise.
    await expect(storage.get('any')).resolves.toBeUndefined()
    expect(openCalls).toBe(2)
  })
})
