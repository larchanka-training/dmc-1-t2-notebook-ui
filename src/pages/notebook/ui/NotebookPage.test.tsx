import { describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { loadNotebook, notebookLoadedAtom } from '@/features/notebook'
import NotebookPage from './NotebookPage'

function renderPage() {
  return render(
    <TooltipProvider>
      <NotebookPage />
    </TooltipProvider>,
  )
}

describe('NotebookPage (boot gate)', () => {
  test('shows a skeleton until the notebook has loaded, then the editor', async () => {
    // context.reset() in the shared setup resets notebookLoadedAtom to false.
    expect(notebookLoadedAtom()).toBe(false)
    renderPage()
    // Editor header is not on screen yet — only the skeleton placeholder.
    expect(screen.queryByText('JS Notebook')).not.toBeInTheDocument()

    await act(async () => {
      await loadNotebook()
    })

    // Load settled → gate opens, NotebookView (with its header) renders.
    expect(screen.getByText('JS Notebook')).toBeInTheDocument()
  })
})
