import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  test('renders headings', () => {
    const { container } = render(<MarkdownView source="# Title" />)
    const h1 = container.querySelector('h1')
    expect(h1?.textContent).toBe('Title')
  })

  test('renders GFM tables', () => {
    const md = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')
    const { container } = render(<MarkdownView source={md} />)
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })

  test('highlights fenced code blocks (hljs classes)', () => {
    const md = ['```js', 'const x = 1', '```'].join('\n')
    const { container } = render(<MarkdownView source={md} />)
    const code = container.querySelector('pre code')
    expect(code?.className).toContain('hljs')
    expect(code?.className).toContain('language-js')
    // rehype-highlight tokenizes into child spans
    expect(code?.querySelector('span')).not.toBeNull()
  })

  test('renders inline LaTeX math via KaTeX', () => {
    const { container } = render(<MarkdownView source="Euler: $e^{i\\pi}+1=0$" />)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  test('renders block LaTeX math via KaTeX', () => {
    const { container } = render(<MarkdownView source={'$$\\int_0^1 x\\,dx$$'} />)
    expect(container.querySelector('.katex')).not.toBeNull()
  })

  test('opens links in a new tab with safe rel', () => {
    const { container } = render(<MarkdownView source="[veai](https://example.com)" />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toContain('noreferrer')
  })

  // XSS guard: raw HTML in the source must never reach the DOM as live nodes.
  // Without rehype-raw, react-markdown escapes it to text — there is no
  // <script>/<img> element and thus nothing to execute.
  test('does not render raw HTML embedded in markdown', () => {
    const { container } = render(
      <MarkdownView
        source={'<script>window.__xss = true</script><img src=x onerror="alert(1)">'}
      />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined()
  })
})
