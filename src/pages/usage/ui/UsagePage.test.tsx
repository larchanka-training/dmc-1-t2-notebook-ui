import { afterEach, describe, expect, test, vi } from 'vitest'
import { urlAtom } from '@reatom/core'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// `restoreDemo` opens the restored notebook into the editor slot via
// `openNotebookInSlot`, imported as a NAMED binding from the notebook barrel
// (a runtime spy would not be seen at the call site). Mock the barrel, replacing
// ONLY that action with a spy and keeping every other export real.
vi.mock('@/features/notebook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/notebook')>()
  return { ...actual, openNotebookInSlot: vi.fn().mockResolvedValue('opened') }
})

import {
  DEMO_NOTEBOOK_ID,
  isSeedTombstoned,
  notebookListResource,
  openNotebookInSlot,
  resolveDemoNotebookId,
  setSeedTombstone,
} from '@/features/notebook'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import { userAtom } from '@/entities/session'
import UsagePage from './UsagePage'

describe('UsagePage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    userAtom.set(null)
  })

  test('renders the actual output contract and sandbox guidance', () => {
    render(<UsagePage />)
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByText(/OutputItem\[\]/)).toBeInTheDocument()
    expect(screen.getByText('console.log')).toBeInTheDocument()
    expect(screen.getByText('console.warn')).toBeInTheDocument()
    expect(screen.getByText('fetch')).toBeInTheDocument()
    expect(screen.getByText(/raw base64 without a/i)).toBeInTheDocument()
    expect(screen.getAllByText(/canvas/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/lives only in this browser/i)).toBeInTheDocument()
  })

  test('renders a copy button for every runnable example', () => {
    render(<UsagePage />)

    expect(screen.getAllByRole('button', { name: /^copy$/i })).toHaveLength(8)
  })

  test('shows non-blocking feedback after copying an example', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<UsagePage />)

    await user.click(screen.getAllByRole('button', { name: /^copy$/i })[0])

    expect(writeText).toHaveBeenCalledWith('const x = 2 + 2\nx')
    expect(await screen.findByRole('button', { name: /copied!/i })).toBeInTheDocument()
  })

  test('hides restore button when the demo notebook exists locally', async () => {
    vi.spyOn(notebookStorage, 'get').mockResolvedValue({
      id: DEMO_NOTEBOOK_ID,
      title: '📗 My first notebook, full of features',
      formatVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      cells: [],
    })

    render(<UsagePage />)

    expect(screen.queryByRole('button', { name: /restore demo/i })).not.toBeInTheDocument()
  })

  test('public (signed-out) view shows examples but never the seed-restore block (TARDIS-167 №22)', async () => {
    userAtom.set(null)
    // Even if a local demo were somehow absent, a signed-out visitor must not see
    // the per-account restore block — and the per-owner demo id resolver must not
    // be called.
    const getSpy = vi.spyOn(notebookStorage, 'get')
    // Regression (gpt review): the presence detector must check the user BEFORE
    // reading `notebookListResource.data()`. Reading it makes the async list
    // resource hot and fires the protected GET /notebooks WITHOUT a token — a 401
    // on a public page. Assert the list is never fetched while signed out.
    const listSpy = vi.spyOn(notebookApi, 'list')

    render(<UsagePage />)

    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restore demo/i })).not.toBeInTheDocument()
    expect(getSpy).not.toHaveBeenCalled()
    // Give any (incorrect) async resource compute a tick to fire before asserting.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument())
    expect(listSpy).not.toHaveBeenCalled()
  })

  test('restoring lifts the tombstone, stamps ownership and opens the notebook (TARDIS-167 №23 / #61 #67)', async () => {
    const user = userEvent.setup()
    await notebookStorage.clearAll()
    notebookListResource.data.set([])
    userAtom.set({ id: 'restore-owner', email: 'a@b.com', roles: [] } as never)
    // Seed was deleted earlier → tombstoned, so the restore block is visible.
    await setSeedTombstone()
    const demoId = await resolveDemoNotebookId()
    vi.spyOn(notebookApi, 'restoreFeaturesDemo').mockResolvedValue({
      id: demoId,
      title: 'Welcome',
      ownerId: 'restore-owner',
      formatVersion: 1,
      createdAt: 1,
      updatedAt: 9,
      cells: [],
    } as Awaited<ReturnType<typeof notebookApi.restoreFeaturesDemo>>)

    render(<UsagePage />)
    await user.click(await screen.findByRole('button', { name: /restore demo/i }))

    await waitFor(() => expect(notebookApi.restoreFeaturesDemo).toHaveBeenCalled())
    // Tombstone lifted, document written with owner sync-state, slot opened.
    expect(await isSeedTombstoned()).toBe(false)
    expect(await notebookStorage.get(demoId)).toBeDefined()
    expect((await notebookStorage.getSyncState(demoId))?.ownerId).toBe('restore-owner')
    expect(vi.mocked(openNotebookInSlot)).toHaveBeenCalledWith(demoId)
    // The restored seed is surfaced in the sidebar list immediately (no refetch).
    expect(notebookListResource.data().some((it) => it.id === demoId)).toBe(true)
    // Review #4: restore navigates away from /usage to the editor (notebook route).
    expect(urlAtom().pathname).toBe('/')
    await notebookStorage.clearAll()
    notebookListResource.data.set([])
  })
})
