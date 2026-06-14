import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SyncIndicator } from './SyncIndicator'
import { pausedAtom, remoteSyncStatusAtom, type RemoteSyncStatus } from '../model/remoteSync'

function renderWith(status: RemoteSyncStatus, paused = false) {
  act(() => {
    remoteSyncStatusAtom.set(status)
    pausedAtom.set(paused)
  })
  return render(<SyncIndicator />)
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  act(() => {
    remoteSyncStatusAtom.set('idle')
    pausedAtom.set(false)
  })
})

describe('SyncIndicator', () => {
  test('shows nothing when idle', () => {
    const { container } = renderWith('idle')
    expect(container).toBeEmptyDOMElement()
  })

  test('shows "Syncing…" while syncing', () => {
    renderWith('syncing')
    expect(screen.getByText(/syncing/i)).toBeInTheDocument()
  })

  test('shows synced state', () => {
    renderWith('synced')
    expect(screen.getByText(/^synced$/i)).toBeInTheDocument()
  })

  test('shows an offline hint', () => {
    renderWith('offline')
    expect(screen.getByText(/offline/i)).toBeInTheDocument()
  })

  test('distinguishes a transient error (retrying) from a terminal failure (CL-13)', () => {
    // Transient 'error' — a retry is armed — reads as a soft retrying hint, NOT the
    // hard "Sync failed".
    renderWith('error')
    expect(screen.getByText(/retrying/i)).toBeInTheDocument()
    expect(screen.queryByText(/^sync failed$/i)).toBeNull()
    cleanup()
    // Terminal 'failed' — no auto-retry — reads as the hard error.
    renderWith('failed')
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument()
    expect(screen.queryByText(/retrying/i)).toBeNull()
  })

  test('prioritises the re-login prompt when paused, over any status', () => {
    // Paused wins even if the underlying status is, say, "syncing".
    renderWith('syncing', true)
    expect(screen.getByText(/sign in again/i)).toBeInTheDocument()
    expect(screen.queryByText(/syncing/i)).toBeNull()
  })

  // AC-14 honesty constraint (CL-10): the UI must NOT promise an untrusted-device
  // data wipe before #136. Guarded by a code comment today; this asserts it so a
  // future edit re-adding wipe copy fails CI instead of shipping a false promise.
  test('never renders device-wipe copy in any status (AC-14)', () => {
    const wipeCopy = /wipe|erased|cleared from this device|deleted from this device/i
    for (const status of ['idle', 'syncing', 'synced', 'offline', 'error', 'failed'] as const) {
      const { container } = renderWith(status)
      expect(container.textContent ?? '').not.toMatch(wipeCopy)
      cleanup()
    }
    const { container } = renderWith('idle', true) // paused → re-login prompt
    expect(container.textContent ?? '').not.toMatch(wipeCopy)
  })
})
