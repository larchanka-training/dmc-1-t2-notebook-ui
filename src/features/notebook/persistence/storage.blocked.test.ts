// Regression (#135 follow-up): the v2 (#134) schema bump added the `sync` store
// without `blocked`/`blocking` handlers, so a tab holding an old connection open
// could hang another tab's upgrade. This locks in that:
//   - `blocking` closes our connection AND clears the cached db promise, so the
//     other tab's upgrade proceeds and our next call transparently reopens;
//   - `terminated` clears the cache so a browser-killed connection is not reused.
//
// We capture the callbacks idb is opened with (rather than driving a real
// cross-tab upgrade, which fake-indexeddb cannot stage) and exercise them.
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('idb')
  vi.resetModules()
})

type OpenCallbacks = {
  blocking?: (cur: number, blocked: number | null, event: Event) => void
  terminated?: () => void
}

async function loadStorageCapturingCallbacks() {
  vi.resetModules()
  let captured: OpenCallbacks = {}
  vi.doMock('idb', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb')
    return {
      ...actual,
      openDB: (name: string, version: number, cbs: OpenCallbacks) => {
        captured = cbs
        return actual.openDB(name, version, cbs as never)
      },
    }
  })
  const storage = await import('./storage')
  // Force the (memoised) open so the callbacks are captured.
  await storage.get('any')
  return { storage, getCallbacks: () => captured }
}

describe('notebook storage — blocked/terminated upgrade handling', () => {
  test('blocking closes the connection and lets the next call reopen', async () => {
    const { storage, getCallbacks } = await loadStorageCapturingCallbacks()
    const close = vi.fn()

    // Simulate another tab trying to upgrade: our `blocking` handler fires.
    getCallbacks().blocking?.(2, 3, { target: { close } } as unknown as Event)
    expect(close).toHaveBeenCalledTimes(1)

    // The cached promise was cleared, so a subsequent call reopens successfully.
    await expect(storage.get('any')).resolves.toBeUndefined()
  })

  test('terminated clears the cache so the next call reopens', async () => {
    const { storage, getCallbacks } = await loadStorageCapturingCallbacks()

    getCallbacks().terminated?.()

    await expect(storage.get('any')).resolves.toBeUndefined()
  })
})
