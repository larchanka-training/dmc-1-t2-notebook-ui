import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { OutputFrame } from './OutputFrame'

describe('OutputFrame — sandbox hardening', () => {
  test('embeds a CSP that blocks network (default-src none) but allows inline + data images', () => {
    const { container } = render(<OutputFrame html="<b>hi</b>" />)
    const iframe = container.querySelector('iframe')!
    const srcDoc = iframe.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).toContain("default-src 'none'")
    // No connect-src directive => fetch/XHR/WebSocket fall back to default-src
    // 'none' and are blocked. Inline script/style + data/blob images allowed.
    expect(srcDoc).not.toContain('connect-src')
    expect(srcDoc).toContain("script-src 'unsafe-inline'")
    expect(srcDoc).toContain('img-src data: blob:')
  })

  test('keeps allow-scripts but never allow-same-origin', () => {
    const { container } = render(<OutputFrame html="<b>hi</b>" />)
    const sandbox = container.querySelector('iframe')!.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
  })

  describe('watchdog', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('replaces the iframe with a notice when no ping arrives in time', () => {
      const { container, queryByText } = renderWithQueries(<OutputFrame html="<b>x</b>" />)
      expect(container.querySelector('iframe')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(2_100)
      })
      expect(container.querySelector('iframe')).toBeNull()
      expect(queryByText(/did not respond/i)).not.toBeNull()
    })
  })
})

function renderWithQueries(ui: React.ReactElement) {
  const result = render(ui)
  return {
    ...result,
    queryByText: (re: RegExp) =>
      Array.from(result.container.querySelectorAll('*')).find(
        (el) => el.children.length === 0 && re.test(el.textContent ?? ''),
      ) ?? null,
  }
}
