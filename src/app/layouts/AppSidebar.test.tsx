import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { SidebarProvider } from '@/shared/ui/sidebar'
import { setSession, clearSession } from '@/entities/session'
import { notebook as notebookApi } from '@/shared/api'
import { notebookListResource } from '@/features/notebook'
import { AppSidebar } from './AppSidebar'

// AppSidebar opens a notebook into the slot via the `openNotebookInSlot` action
// imported as a NAMED binding from the notebook barrel, so a runtime spy would
// not be seen at the call site. Mock the barrel, replacing ONLY that action with
// a spy and keeping every other export real so the sidebar still renders.
vi.mock('@/features/notebook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/notebook')>()
  return { ...actual, openNotebookInSlot: vi.fn() }
})

// jsdom's innerWidth (1024) is below the 1280 mobile breakpoint, so the Sidebar
// primitive would render its closed mobile Sheet (nothing in the DOM). Force the
// desktop branch so the notebook rows are present and clickable.
vi.mock('@/shared/lib/use-mobile', () => ({ useIsMobile: () => false }))

const { openNotebookInSlot } = await import('@/features/notebook')

const BACKEND_ID = '44444444-4444-4444-8444-444444444444'

function listItem(id: string, title: string): notebookApi.NotebookListItem {
  return { id, title, formatVersion: 1, createdAt: 0, updatedAt: 0, cellsCount: 0 }
}

function renderSidebar() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.mocked(openNotebookInSlot).mockClear()
  setSession({
    accessToken: 'tok',
    refreshToken: 'ref',
    user: { id: 'u1', email: 'a@b.com', roles: [] },
  })
  notebookListResource.data.set([listItem(BACKEND_ID, 'Backend notebook')])
})

afterEach(() => {
  cleanup()
  clearSession()
  notebookListResource.data.set([])
})

describe('AppSidebar — open-into-slot', () => {
  test('clicking a backend notebook row opens it into the slot', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByText('Backend notebook'))

    expect(vi.mocked(openNotebookInSlot)).toHaveBeenCalledWith(BACKEND_ID)
  })
})

describe('AppSidebar — create guard (FU3)', () => {
  test('disables the "+" button while a create is in flight', async () => {
    const user = userEvent.setup()
    // Hang the POST so the action stays in flight; the button must disable to
    // block a second concurrent create from a double-click.
    let resolveCreate!: (nb: notebookApi.Notebook) => void
    vi.spyOn(notebookApi, 'create').mockReturnValue(
      new Promise<notebookApi.Notebook>((resolve) => {
        resolveCreate = resolve
      }),
    )
    vi.spyOn(notebookApi, 'list').mockResolvedValue([])
    renderSidebar()

    const addButton = screen.getByRole('button', { name: /new notebook/i })
    expect(addButton).toBeEnabled()

    await user.click(addButton)
    // While the create promise is pending, the action is not ready → disabled.
    expect(addButton).toBeDisabled()

    // Settle the create inside act so the resulting state update is flushed
    // before the test ends (no dangling promise, no act warning).
    await act(async () => {
      resolveCreate({
        id: BACKEND_ID,
        title: 'Untitled notebook',
        ownerId: 'owner-1',
        formatVersion: 1,
        createdAt: 0,
        updatedAt: 0,
        cells: [],
      })
    })
  })
})
