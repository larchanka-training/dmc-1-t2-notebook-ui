import { describe, expect, test, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookCell } from './NotebookCell'

function renderCell(props: Partial<React.ComponentProps<typeof NotebookCell>> = {}) {
  return render(
    <TooltipProvider>
      <NotebookCell kind="markdown" code="# Hi" {...props} />
    </TooltipProvider>,
  )
}

describe('NotebookCell — markdown modal editing', () => {
  test('Esc in a markdown editor blurs and exits to command mode', () => {
    const onExitToCommand = vi.fn()
    const { container } = renderCell({ viewMode: 'edit', onExitToCommand })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    // React listens at the root, so dispatch on the node bubbles to its handler.
    expect(onExitToCommand).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(textarea)
  })

  test('autoFocus pulls focus into the markdown textarea (edit mode)', async () => {
    const { container } = renderCell({ viewMode: 'edit', autoFocus: true })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await waitFor(() => expect(document.activeElement).toBe(textarea))
  })

  test('autoFocus on a previewing markdown cell switches it back to edit', () => {
    const onViewModeChange = vi.fn()
    renderCell({ viewMode: 'preview', autoFocus: true, onViewModeChange })
    expect(onViewModeChange).toHaveBeenCalledWith('edit')
  })
})
