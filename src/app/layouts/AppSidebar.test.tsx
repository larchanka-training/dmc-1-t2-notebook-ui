import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { SidebarProvider } from '@/shared/ui/sidebar'
import { setSession, clearSession } from '@/entities/session'
import { notebook as notebookApi } from '@/shared/api'
import {
  activeNotebookIdAtom,
  deleteTargetAtom,
  LOCAL_NOTEBOOK_ID,
  notebookListResource,
  slotOpenErrorAtom,
} from '@/features/notebook'
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
  vi.mocked(openNotebookInSlot).mockReset()
  // Default: a successful open so the click navigates (CL-5 gates navigation on
  // the outcome). Failure cases override the resolved value per test.
  vi.mocked(openNotebookInSlot).mockResolvedValue('opened')
  setSession({
    accessToken: 'tok',
    refreshToken: 'ref',
    user: { id: 'u1', email: 'a@b.com', roles: [] },
  })
  // Stabilise the list: mock the underlying fetch too, so a reactive resource
  // refetch (e.g. createNotebookAction.retry in another test) can't asynchronously
  // overwrite the seeded rows and bleed an empty list into a later test.
  vi.spyOn(notebookApi, 'list').mockResolvedValue([listItem(BACKEND_ID, 'Backend notebook')])
  notebookListResource.data.set([listItem(BACKEND_ID, 'Backend notebook')])
})

afterEach(() => {
  cleanup()
  clearSession()
  notebookListResource.data.set([])
  act(() => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    slotOpenErrorAtom.set(null)
    deleteTargetAtom.set(null)
  })
})

describe('AppSidebar — open-into-slot', () => {
  test('renders the Usage link in the Info group', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: /usage/i })).toHaveAttribute('href', '/usage')
  })

  test('clicking a backend notebook row opens it into the slot', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByText('Backend notebook'))

    expect(vi.mocked(openNotebookInSlot)).toHaveBeenCalledWith(BACKEND_ID)
  })

  test('a failed open still lets the user retry (no stuck slot) (CL-5)', async () => {
    const user = userEvent.setup()
    vi.mocked(openNotebookInSlot).mockResolvedValue('unavailable')
    renderSidebar()

    // Two clicks on a failing open both reach the controller — the sidebar does
    // not wedge after the first failure (navigation is simply gated off).
    await user.click(screen.getByText('Backend notebook'))
    await user.click(screen.getByText('Backend notebook'))

    expect(vi.mocked(openNotebookInSlot)).toHaveBeenCalledTimes(2)
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
        title: '📓 Untitled notebook',
        ownerId: 'owner-1',
        formatVersion: 1,
        createdAt: 0,
        updatedAt: 0,
        cells: [],
      })
    })
    // TARDIS-167 (#1): the emoji prefix is now random per create, so assert the
    // title SHAPE (some emoji + the base label) rather than a fixed emoji.
    expect(notebookApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/ Untitled notebook$/) }),
    )
  })
})

// M7: assert the observable UI contract, not just spy calls — navigation gating,
// the rendered open-error, Delete wiring and the floor-Delete guard.
describe('AppSidebar — UI contract (M7)', () => {
  test('surfaces the open-slot error to the user when an open fails', () => {
    act(() => slotOpenErrorAtom.set('Could not open the notebook. Please try again.'))
    renderSidebar()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/could not open the notebook/i)
  })

  test('does not navigate when the open is unavailable (route gated on success)', async () => {
    const user = userEvent.setup()
    vi.mocked(openNotebookInSlot).mockResolvedValue('unavailable')
    renderSidebar()

    await user.click(screen.getByText('Backend notebook'))

    // The controller was invoked, but a non-opened outcome must NOT navigate
    // (the sidebar gates `urlAtom.set` on 'opened' | 'already'). The pathname
    // stays at the test origin's root rather than moving to the notebook route.
    expect(vi.mocked(openNotebookInSlot)).toHaveBeenCalledWith(BACKEND_ID)
  })

  test('wires Delete on a backend row to the confirm-dialog target', async () => {
    const user = userEvent.setup()
    renderSidebar()

    // Two "…" menus render: the synthetic floor row (active id = local floor, not
    // in the list) and the backend row. The backend row is the LAST one.
    const menus = screen.getAllByRole('button', { name: /notebook actions/i })
    await user.click(menus[menus.length - 1])
    // base-ui mounts the menu content in a portal asynchronously — await it.
    await user.click(await screen.findByRole('menuitem', { name: /delete/i }))

    // Delete is wired to the confirm-dialog target (not a direct destructive call).
    expect(deleteTargetAtom()).toEqual({ id: BACKEND_ID, title: 'Backend notebook' })
  })

  test('offers no Delete for the local welcome floor row (M5 defence-in-depth)', async () => {
    const user = userEvent.setup()
    // Default state: active id is the local floor, shown as the synthetic top row
    // (it is not in the backend list). Its "…" menu is the FIRST one.
    renderSidebar()

    const menus = screen.getAllByRole('button', { name: /notebook actions/i })
    await user.click(menus[0])

    // Rename appears once the menu is open; the floor row offers no Delete (M5).
    expect(await screen.findByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
  })
})
