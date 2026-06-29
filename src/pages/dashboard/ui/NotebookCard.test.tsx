import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { urlAtom } from '@reatom/core'
import type { OpenOutcome } from '@/features/notebook'

// Mock only `openNotebookInSlot` from the notebook barrel; keep everything else
// real. The card's behaviour under test is the branch "navigate to the notebook
// route ONLY when the open succeeds (`opened`/`already`)" — so we drive the
// outcome and assert the URL.
const openMock = vi.hoisted(() => vi.fn<(id: string) => Promise<OpenOutcome>>())
vi.mock('@/features/notebook', async (importActual) => {
  const actual = await importActual<typeof import('@/features/notebook')>()
  return { ...actual, openNotebookInSlot: openMock }
})

import { NotebookCard } from './NotebookCard'
import type { DashboardCard } from '../model/dashboardData'

const CARD: DashboardCard = { id: 'nb-1', title: 'My notebook', cellsCount: 3, createdAt: 1 }
const BASE = import.meta.env.BASE_URL
const OTHER = `${BASE}usage`

beforeEach(() => {
  openMock.mockReset()
  // Start on a non-notebook route so a navigation to the notebook route ('' →
  // BASE) is observable as a pathname change.
  urlAtom.set((url) => new URL(OTHER, url.origin), true)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('NotebookCard click → open outcome → navigation (TARDIS-183)', () => {
  test('renders the title and metadata', () => {
    render(<NotebookCard card={CARD} />)
    expect(screen.getByText('My notebook')).toBeInTheDocument()
    expect(screen.getByText('3 cells')).toBeInTheDocument()
  })

  test.each(['opened', 'already'] as const)(
    'navigates to the notebook route when open returns %s',
    async (outcome) => {
      openMock.mockResolvedValue(outcome)
      const user = userEvent.setup()
      render(<NotebookCard card={CARD} />)

      await user.click(screen.getByRole('button'))

      expect(openMock).toHaveBeenCalledWith('nb-1')
      expect(urlAtom().pathname).toBe(BASE)
    },
  )

  test.each(['busy', 'error', 'unavailable', 'superseded'] as const)(
    'stays on the current route when open returns %s',
    async (outcome) => {
      openMock.mockResolvedValue(outcome)
      const user = userEvent.setup()
      render(<NotebookCard card={CARD} />)

      await user.click(screen.getByRole('button'))

      expect(openMock).toHaveBeenCalledWith('nb-1')
      // No navigation — still on the route we started on.
      expect(urlAtom().pathname).toBe(new URL(OTHER, 'http://localhost').pathname)
    },
  )
})
