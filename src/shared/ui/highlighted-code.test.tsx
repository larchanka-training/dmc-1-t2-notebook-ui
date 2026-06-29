import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { HighlightedCode } from './highlighted-code'

describe('HighlightedCode', () => {
  test('renders the verbatim code text', () => {
    const { container } = render(<HighlightedCode code="const x = 2 + 2" />)
    expect(container.textContent).toBe('const x = 2 + 2')
  })

  test('emits highlight.js token classes (.hljs-keyword) for JavaScript', () => {
    const { container } = render(<HighlightedCode code="const x = 2" />)
    const code = container.querySelector('code.hljs')
    expect(code).not.toBeNull()
    // `const` is highlighted as a keyword by highlight.js's JS grammar.
    expect(code!.querySelector('.hljs-keyword')?.textContent).toBe('const')
  })

  test('wraps the code in a <pre><code> structure', () => {
    const { container } = render(<HighlightedCode code="x" />)
    expect(container.querySelector('pre > code.hljs')).not.toBeNull()
  })
})
