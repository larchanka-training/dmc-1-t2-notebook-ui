import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { lastSavedAtAtom, type SaveStatus, saveStatusAtom } from '../model/autosave'
import { SaveIndicator } from './SaveIndicator'

// Seed the model state before rendering, so the component reads the target
// status on its initial (synchronous) render — no post-render reactive update,
// hence no act() warning.
function seedStatus(status: SaveStatus, lastSavedAt: number | null = null) {
  lastSavedAtAtom.set(lastSavedAt)
  saveStatusAtom.set(status)
}

describe('SaveIndicator', () => {
  afterEach(() => {
    // Unmount first, then reset the atoms: with no component subscribed, the
    // status change triggers no reactive re-render (so no act() warning).
    cleanup()
    seedStatus('idle')
  })

  test('renders nothing while idle before the first save', () => {
    const { container } = render(<SaveIndicator />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows "Saving…" while a save is in flight', () => {
    seedStatus('saving')
    render(<SaveIndicator />)
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
  })

  test('shows the saved timestamp after a successful save', () => {
    seedStatus('saved', Date.parse('2026-06-01T12:34:01'))
    render(<SaveIndicator />)
    expect(screen.getByText(/^Saved ·/)).toBeInTheDocument()
  })

  test('offers a retry button on error', () => {
    seedStatus('error')
    render(<SaveIndicator />)
    expect(screen.getByRole('button', { name: /save failed — retry/i })).toBeInTheDocument()
  })

  test('offers reload and overwrite actions on cross-tab conflict', () => {
    seedStatus('conflict')
    render(<SaveIndicator />)
    expect(screen.getByText(/changed in another tab/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save mine/i })).toBeInTheDocument()
  })
})
