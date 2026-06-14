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

  test('shows a sync failure for transient error and terminal failed alike', () => {
    renderWith('error')
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument()
    cleanup()
    renderWith('failed')
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument()
  })

  test('prioritises the re-login prompt when paused, over any status', () => {
    // Paused wins even if the underlying status is, say, "syncing".
    renderWith('syncing', true)
    expect(screen.getByText(/sign in again/i)).toBeInTheDocument()
    expect(screen.queryByText(/syncing/i)).toBeNull()
  })
})
