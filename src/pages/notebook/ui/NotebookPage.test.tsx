import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { notebookLoadedAtom } from '@/features/notebook'
import NotebookPage from './NotebookPage'

function renderPage() {
  return render(
    <TooltipProvider>
      <NotebookPage />
    </TooltipProvider>,
  )
}

describe('NotebookPage (boot gate)', () => {
  test('shows a skeleton until the notebook has loaded', () => {
    expect(notebookLoadedAtom()).toBe(false)
    renderPage()
    expect(screen.queryByText('notebook.js')).not.toBeInTheDocument()
  })
})
