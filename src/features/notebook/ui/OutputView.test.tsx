import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { OutputView } from './OutputView'
import type { OutputItem } from '../runtime/types'

describe('OutputView — order preservation', () => {
  test('renders html, stdout and result in execution order, not grouped by type', () => {
    // Emission order: html → stdout → result. The old implementation grouped
    // by type (stream → result → rich), which reordered the output. This
    // pins the on-screen order to the emission order.
    const items: OutputItem[] = [
      { type: 'html', html: '<b>first</b>' },
      { type: 'stdout', text: 'second' },
      { type: 'result', value: { kind: 'primitive', value: 2 } },
    ]
    const { container } = render(<OutputView items={items} />)

    // The root container renders one direct child per segment, in order.
    const root = container.firstElementChild!
    const segments = Array.from(root.children)
    expect(segments).toHaveLength(3)
    // The html segment renders an OutputFrame (a wrapper div holding the
    // danger alert + the sandboxed iframe), so assert it CONTAINS an iframe
    // rather than being one itself.
    expect(segments[0].querySelector('iframe')).not.toBeNull()
    expect(segments[1].textContent).toContain('second')
    expect(segments[2].textContent).toContain('⟹')
  })

  test('marks each visual segment for uniform separators', () => {
    const items: OutputItem[] = [
      { type: 'stdout', text: 'a' },
      { type: 'result', value: { kind: 'primitive', value: 1 } },
      { type: 'image', mime: 'image/svg+xml', data: 'PHN2Zy8+' },
    ]
    const { container } = render(<OutputView items={items} />)
    expect(container.querySelectorAll('[data-output-segment="true"]')).toHaveLength(3)
  })

  test('merges only consecutive stdout/stderr into one block', () => {
    const items: OutputItem[] = [
      { type: 'stdout', text: 'a' },
      { type: 'stderr', text: 'b' },
      { type: 'result', value: { kind: 'primitive', value: 1 } },
      { type: 'stdout', text: 'c' },
    ]
    const { container } = render(<OutputView items={items} />)
    // Two stream blocks (a+b, then c) split by the result card — assert the
    // first block carries both a and b, the second only c.
    const text = container.textContent ?? ''
    expect(text.indexOf('a')).toBeLessThan(text.indexOf('b'))
    expect(text.indexOf('b')).toBeLessThan(text.indexOf('c'))
  })

  test('renders nothing for an empty list', () => {
    const { container } = render(<OutputView items={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('OutputView — stalled HTML output recovers on re-run (TARDIS-168)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a new HTML output mounts a fresh frame after the previous one stalled', () => {
    const { container, rerender } = render(
      <OutputView items={[{ type: 'html', html: '<b>loop</b>' }]} />,
    )
    expect(container.querySelector('iframe')).not.toBeNull()

    // No heartbeat ever arrives → the watchdog declares the frame stalled and
    // drops the iframe in favour of the "output stopped" notice.
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toMatch(/did not respond/i)

    // Re-running the cell with different HTML must revive the output: the `key`
    // on OutputFrame changes, mounting a fresh instance with a clean lifecycle.
    rerender(<OutputView items={[{ type: 'html', html: '<b>fixed</b>' }]} />)
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.textContent ?? '').not.toMatch(/did not respond/i)
  })
})

describe('OutputView — error hint', () => {
  test('renders the diagnostic hint as a distinct node within the error block', () => {
    const items: OutputItem[] = [
      {
        type: 'error',
        name: 'TypeError',
        message: 'not a function',
        hint: 'Promise rejected; did you forget await?',
      },
    ]
    render(<OutputView items={items} />)
    // The hint is its own node, not folded into the message text...
    const hintNode = screen.getByText('Promise rejected; did you forget await?')
    expect(hintNode.textContent).toBe('Promise rejected; did you forget await?')
    // ...nested inside the same error block that carries name + message.
    expect(hintNode.parentElement?.textContent).toContain('not a function')
  })

  test('renders no hint node when the error has none', () => {
    const items: OutputItem[] = [{ type: 'error', name: 'Error', message: 'boom' }]
    const { container } = render(<OutputView items={items} />)
    expect(container.textContent).not.toContain('did you forget await')
  })
})
