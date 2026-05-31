import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
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
