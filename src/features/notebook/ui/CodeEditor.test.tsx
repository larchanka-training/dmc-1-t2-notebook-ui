import { describe, expect, test, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { CodeEditor } from './CodeEditor'

function getContent(container: HTMLElement) {
  return container.querySelector('.cm-content') as HTMLElement
}

describe('CodeEditor', () => {
  test('renders the initial value', async () => {
    const { container } = render(
      <CodeEditor value="const x = 1" theme="light" onChange={() => {}} />,
    )
    await waitFor(() => expect(getContent(container).textContent).toContain('const x = 1'))
  })

  test('pushes external value changes into the editor', async () => {
    const { container, rerender } = render(
      <CodeEditor value="first" theme="light" onChange={() => {}} />,
    )
    await waitFor(() => expect(getContent(container).textContent).toContain('first'))
    rerender(<CodeEditor value="second" theme="light" onChange={() => {}} />)
    await waitFor(() => expect(getContent(container).textContent).toContain('second'))
  })

  test('mounts a CodeMirror view (single editor instance)', () => {
    const { container } = render(<CodeEditor value="x" theme="dark" onChange={() => {}} />)
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1)
  })

  test('shows the gutter only when line numbers are enabled', async () => {
    const { container, rerender } = render(
      <CodeEditor value="x" theme="light" showLineNumbers={false} onChange={() => {}} />,
    )
    expect(container.querySelector('.cm-lineNumbers')).toBeNull()
    rerender(<CodeEditor value="x" theme="light" showLineNumbers onChange={() => {}} />)
    await waitFor(() => expect(container.querySelector('.cm-lineNumbers')).not.toBeNull())
  })

  test('fires onChange with the new doc on a real document edit', async () => {
    const onChange = vi.fn()
    const { container } = render(<CodeEditor value="a" theme="light" onChange={onChange} />)
    const host = container.querySelector('.cm-content') as HTMLElement
    await waitFor(() => expect(host.textContent).toContain('a'))
    onChange.mockClear()
    // Drive an edit the way the user would, via the editor's own dispatch.
    // The updateListener must translate docChanged into onChange(newDoc).
    const view = EditorView.findFromDOM(host)!
    view.dispatch({ changes: { from: 1, insert: 'b' } })
    expect(onChange).toHaveBeenCalledWith('ab')
  })

  test('does not fire onChange when external value is pushed in', async () => {
    const onChange = vi.fn()
    const { container, rerender } = render(
      <CodeEditor value="x" theme="light" onChange={onChange} />,
    )
    await waitFor(() =>
      expect((container.querySelector('.cm-content') as HTMLElement).textContent).toContain('x'),
    )
    onChange.mockClear()
    rerender(<CodeEditor value="y" theme="light" onChange={onChange} />)
    await waitFor(() =>
      expect((container.querySelector('.cm-content') as HTMLElement).textContent).toContain('y'),
    )
    // External pushes are annotated and must NOT echo back through onChange,
    // otherwise undo/redo (S5) pushing an old value would re-record it.
    expect(onChange).not.toHaveBeenCalled()
  })

  test('Escape exits to command mode and blurs the editor', async () => {
    const onExitToCommand = vi.fn()
    const { container } = render(
      <CodeEditor value="x" theme="light" onChange={() => {}} onExitToCommand={onExitToCommand} />,
    )
    const host = container.querySelector('.cm-content') as HTMLElement
    await waitFor(() => expect(host.textContent).toContain('x'))
    const view = EditorView.findFromDOM(host)!
    view.focus()
    // Dispatch the Escape key through the DOM so CodeMirror's keymap runs it.
    host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    expect(onExitToCommand).toHaveBeenCalledOnce()
    // Focus must leave the editor, otherwise command-mode shortcuts get eaten
    // by the contenteditable as text.
    expect(view.hasFocus).toBe(false)
  })
})
