import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { SidebarProvider } from '@/shared/ui/sidebar'
import { NotebookCell, runAll } from '@/features/notebook'
import { AppTopbar } from './AppTopbar'

// AppTopbar imports `runAll` as a NAMED binding from the notebook barrel, so a
// `vi.spyOn` on the runtime module would not be seen at the call site. Mock the
// barrel instead, replacing ONLY `runAll` with a spy and keeping every other
// export real (SaveIndicator, NotebookToolbar, the outline/search atoms) so the
// topbar still renders, and the real `NotebookCell` is exercised in test 2.
// We assert the hotkey CALLS runAll, never the real kernel — side effects are
// irrelevant, only the call count matters.
vi.mock('@/features/notebook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/notebook')>()
  return { ...actual, runAll: vi.fn() }
})

function renderTopbar(extra?: ReactNode) {
  // useSidebar() throws outside a SidebarProvider; the topbar tooltips need a
  // TooltipProvider. Both wrap every AppTopbar mount.
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppTopbar />
        {extra}
      </SidebarProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  vi.mocked(runAll).mockClear()
})

describe('AppTopbar — global "Run All" hotkey (Mod-Shift-Enter)', () => {
  test('pressing Mod-Shift-Enter on the notebook route triggers runAll exactly once', async () => {
    const user = userEvent.setup()
    renderTopbar()
    // The hotkey is registered only inside the notebook-route branch. Proving
    // those controls mounted (search trigger present) confirms the binding is
    // live before we fire it.
    expect(screen.getByLabelText('Search notebook')).toBeInTheDocument()

    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')

    expect(vi.mocked(runAll)).toHaveBeenCalledTimes(1)
  })

  test("a markdown cell's textarea lets Mod-Shift-Enter bubble to the document handler", async () => {
    const user = userEvent.setup()
    // Spy the cell's own run callbacks: if the textarea swallowed the combo via
    // its generic Enter+modifier branch, it would call onRunAndAdvance. The
    // explicit early `return` in NotebookCell.tsx must skip that branch and let
    // the event reach the document-level Run All hotkey instead.
    const onRunAndAdvance = vi.fn()
    const onRun = vi.fn()
    renderTopbar(
      <NotebookCell kind="markdown" code="hello" onRun={onRun} onRunAndAdvance={onRunAndAdvance} />,
    )

    const textarea = screen.getByPlaceholderText(/markdown/i)
    await user.click(textarea)
    expect(textarea).toHaveFocus()

    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')

    // Bubbled past the textarea to the document handler → Run All fired once...
    expect(vi.mocked(runAll)).toHaveBeenCalledTimes(1)
    // ...and the textarea did NOT hijack the combo into its own run path.
    expect(onRunAndAdvance).not.toHaveBeenCalled()
    expect(onRun).not.toHaveBeenCalled()
  })
})
