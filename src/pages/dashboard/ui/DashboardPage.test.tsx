import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { urlAtom } from '@reatom/core'
import { userAtom } from '@/entities/session'
import type { notebook as notebookApi } from '@/shared/api'

// Mock only `createNotebookFlow` from the notebook barrel; keep everything else
// real (the page reads `notebookListResource`, `slotOpenErrorAtom`, etc.). The
// dashboard-specific behaviour under test: "New notebook" navigates to the
// notebook route ONLY when creation succeeds (the navigation lives in the page's
// onCreate, not in createNotebookFlow).
const createFlowMock = vi.hoisted(() => vi.fn<() => Promise<notebookApi.Notebook | null>>())
vi.mock('@/features/notebook', async (importActual) => {
  const actual = await importActual<typeof import('@/features/notebook')>()
  return { ...actual, createNotebookFlow: createFlowMock }
})

import { notebookListResource } from '@/features/notebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import DashboardPage from './DashboardPage'

const BASE = import.meta.env.BASE_URL
const NB: notebookApi.Notebook = {
  id: 'nb-new',
  title: 'New',
  ownerId: 'owner-A',
  formatVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  cells: [],
}

// NOTE: renders here may emit React "not wrapped in act(...)" warnings from
// @reatom/react's async scheduler — a repo-wide artefact, not a failure (see
// SettingsPage.test.tsx).
//
// The card-list logic (server⊕local merge, metadata, offline fallback, empty
// input, floor dedupe, ordering) is unit-tested exhaustively in
// `dashboardData.test.ts` against the pure `mergeDashboardCards`. These page
// tests cover only what the component itself owns and can assert
// deterministically: the header and the auth gate. (Driving the async
// `dashboardNotebooksResource` to a settled state in jsdom is timing-fragile,
// so card rendering is verified at the model layer instead.)

const USER = { id: 'owner-A', email: 'a@b.com', displayName: null, roles: [] }

beforeEach(async () => {
  await notebookStorage.clearAll()
  notebookListResource.data.set([])
  userAtom.set(USER as never)
})

afterEach(async () => {
  await notebookStorage.clearAll()
  notebookListResource.data.set([])
  userAtom.set(null)
  createFlowMock.mockReset()
})

describe('DashboardPage (TARDIS-183)', () => {
  test('renders the page header', () => {
    render(<DashboardPage />)
    expect(screen.getByRole('heading', { name: 'Your notebooks' })).toBeInTheDocument()
  })

  test('renders nothing when signed out (auth gate, no list fetch)', () => {
    userAtom.set(null)
    const { container } = render(<DashboardPage />)
    expect(container).toBeEmptyDOMElement()
  })

  // The dashboard-specific navigation: createNotebookFlow opens the notebook in
  // the slot but does NOT navigate — onCreate does. So this thin "created →
  // navigate / null → stay" layer lives only in DashboardPage.
  test('New notebook navigates to the notebook route on successful create', async () => {
    createFlowMock.mockResolvedValue(NB)
    // Start on a non-notebook route so a navigation to BASE is observable.
    urlAtom.set((url) => new URL(`${BASE}dashboard`, url.origin), true)
    const user = userEvent.setup()
    render(<DashboardPage />)

    await user.click(screen.getByRole('button', { name: /new notebook/i }))

    expect(createFlowMock).toHaveBeenCalled()
    expect(urlAtom().pathname).toBe(BASE)
  })

  test('New notebook stays on the dashboard when create fails (null)', async () => {
    createFlowMock.mockResolvedValue(null)
    const startPath = new URL(`${BASE}dashboard`, 'http://localhost').pathname
    urlAtom.set((url) => new URL(`${BASE}dashboard`, url.origin), true)
    const user = userEvent.setup()
    render(<DashboardPage />)

    await user.click(screen.getByRole('button', { name: /new notebook/i }))

    expect(createFlowMock).toHaveBeenCalled()
    // No navigation — still on the dashboard.
    expect(urlAtom().pathname).toBe(startPath)
  })
})
