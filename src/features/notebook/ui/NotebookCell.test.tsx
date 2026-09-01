import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import type { OutputItem } from '../runtime/types'
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

  // Markdown edit-mode Enter combos mirror the code editor, but a markdown
  // cell is rendered (switched to preview), never executed: the handlers must
  // request preview and the advance/insert callback, never a run.
  function pressEnter(
    textarea: HTMLTextAreaElement,
    mods: Partial<Pick<KeyboardEventInit, 'shiftKey' | 'altKey' | 'metaKey'>>,
  ) {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...mods }),
    )
  }

  test('Shift+Enter previews the markdown cell and advances (no run)', () => {
    const onViewModeChange = vi.fn()
    const onRunAndAdvance = vi.fn()
    const onRunAndInsertBelow = vi.fn()
    const { container } = renderCell({
      viewMode: 'edit',
      onViewModeChange,
      onRunAndAdvance,
      onRunAndInsertBelow,
    })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.focus()
    pressEnter(textarea, { shiftKey: true })
    expect(onViewModeChange).toHaveBeenCalledWith('preview')
    expect(onRunAndAdvance).toHaveBeenCalledOnce()
    expect(onRunAndInsertBelow).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(textarea)
  })

  test('Alt+Enter previews the markdown cell and inserts below (no run)', () => {
    const onViewModeChange = vi.fn()
    const onRunAndAdvance = vi.fn()
    const onRunAndInsertBelow = vi.fn()
    const { container } = renderCell({
      viewMode: 'edit',
      onViewModeChange,
      onRunAndAdvance,
      onRunAndInsertBelow,
    })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.focus()
    pressEnter(textarea, { altKey: true })
    expect(onViewModeChange).toHaveBeenCalledWith('preview')
    expect(onRunAndInsertBelow).toHaveBeenCalledOnce()
    expect(onRunAndAdvance).not.toHaveBeenCalled()
  })

  test('Cmd/Ctrl+Enter previews the markdown cell and stays (command mode)', () => {
    const onViewModeChange = vi.fn()
    const onExitToCommand = vi.fn()
    const onRunAndAdvance = vi.fn()
    const { container } = renderCell({
      viewMode: 'edit',
      onViewModeChange,
      onExitToCommand,
      onRunAndAdvance,
    })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.focus()
    pressEnter(textarea, { metaKey: true })
    expect(onViewModeChange).toHaveBeenCalledWith('preview')
    expect(onExitToCommand).toHaveBeenCalledOnce()
    expect(onRunAndAdvance).not.toHaveBeenCalled()
  })

  test('a plain Enter does not preview or advance (newline stays)', () => {
    const onViewModeChange = vi.fn()
    const onRunAndAdvance = vi.fn()
    const { container } = renderCell({ viewMode: 'edit', onViewModeChange, onRunAndAdvance })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.focus()
    pressEnter(textarea, {})
    expect(onViewModeChange).not.toHaveBeenCalled()
    expect(onRunAndAdvance).not.toHaveBeenCalled()
  })
})

describe('NotebookCell — in-browser agent gate (TARDIS-167 №4)', () => {
  // The in-browser generate button is the markdown cell's Bot button. Its
  // accessible name is the agent label; on a markdown cell that is
  // "Generate code · in-browser agent".
  function inBrowserButton(container: HTMLElement): HTMLButtonElement {
    const btn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Generate code · in-browser agent"]',
    )
    if (!btn) throw new Error('in-browser agent button not found')
    return btn
  }

  test('is disabled when no model is loaded (generatorLoaded=false)', () => {
    const onInBrowserGenerate = vi.fn()
    const { container } = renderCell({
      kind: 'markdown',
      generatorLoaded: false,
      onInBrowserGenerate,
    })
    expect(inBrowserButton(container)).toBeDisabled()
  })

  test('is enabled once a model is loaded (generatorLoaded=true)', () => {
    const { container } = renderCell({
      kind: 'markdown',
      generatorLoaded: true,
      onInBrowserGenerate: vi.fn(),
    })
    expect(inBrowserButton(container)).not.toBeDisabled()
  })
})

describe('NotebookCell — Output footer header', () => {
  test('shows the "Output [N]" header even when an output item is an error', () => {
    // Regression: output is an array, so logs/results can sit alongside an
    // error. Hiding the header on error misread the run as "error, no output".
    const output: OutputItem[] = [
      { type: 'stdout', text: 'before the error' },
      { type: 'error', name: 'ReferenceError', message: 'x is not defined' },
    ]
    const { container } = renderCell({
      kind: 'code',
      code: 'x',
      output,
      status: 'error',
      executionCount: 3,
    })
    const text = container.textContent ?? ''
    // The point is the header renders on error; the bracket count is the
    // footer's own concern, so don't couple to its exact value.
    expect(text).toMatch(/Output \[\d+\]/)
    expect(text).toContain('before the error')
    expect(text).toContain('x is not defined')
  })

  test('still shows the "Output [N]" header for a clean run', () => {
    const { container } = renderCell({
      kind: 'code',
      code: 'console.log("hello")',
      output: [{ type: 'stdout', text: 'hello' }],
      status: 'done',
      executionCount: 1,
    })
    expect(container.textContent).toMatch(/Output \[\d+\]/)
  })
})

// Step 8d-2 review follow-up: the cell toolbar is the third cloud surface and its
// Beta state had no test.
describe('NotebookCell — cloud tier beta labelling (Step 8d-2)', () => {
  test('includes the Beta status in the cloud control accessible name', () => {
    renderCell({ kind: 'markdown', onCloudGenerate: () => {} })

    expect(
      screen.getByRole('button', { name: 'Generate code · cloud agent (Beta)' }),
    ).toBeInTheDocument()
  })

  test('hovering the cloud control surfaces the limited-testing hint', async () => {
    const user = userEvent.setup()
    renderCell({ kind: 'markdown', onCloudGenerate: () => {} })

    const cloudButton = screen.getByRole('button', { name: /cloud agent/i })
    await user.hover(cloudButton)

    // The tooltip explains the Beta status beyond the concise accessible name.
    expect(await screen.findByText(/limited testing/i)).toBeInTheDocument()
  })

  test('master switch disables both agent tiers even when their dependencies are ready', () => {
    const { container } = renderCell({
      kind: 'markdown',
      llmEnabled: false,
      generatorLoaded: true,
      onInBrowserGenerate: vi.fn(),
      onCloudGenerate: vi.fn(),
    })

    expect(
      container.querySelector('button[aria-label="Generate code · in-browser agent"]'),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: /generate code.*cloud agent/i })).toBeDisabled()
  })
})
