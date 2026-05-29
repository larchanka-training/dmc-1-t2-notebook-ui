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

  describe('watchdog (heartbeat)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('replaces the iframe with a notice when no ping ever arrives', () => {
      const { container, queryByText } = renderWithQueries(<OutputFrame html="<b>x</b>" />)
      expect(container.querySelector('iframe')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      expect(container.querySelector('iframe')).toBeNull()
      expect(queryByText(/did not respond/i)).not.toBeNull()
    })

    test('a single spoofed ping then silence still trips the watchdog', () => {
      // Models the attack the old one-shot liveness flag missed:
      //   <script>parent.postMessage({kind:'iframe-resize',height:80}); while(true){}</script>
      // One heartbeat arrives, then the thread wedges. The sliding window must
      // still elapse and tear the frame down.
      const { container, queryByText } = renderWithQueries(<OutputFrame html="<b>x</b>" />)
      const iframe = container.querySelector('iframe')!
      // The ping triggers a setHeight state update — wrap it in act().
      act(() => {
        pingFrom(iframe, 80)
      })
      // Not enough idle time yet — one ping kept it alive briefly.
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(container.querySelector('iframe')).not.toBeNull()
      // Now let the heartbeat window lapse with no further pings.
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      expect(container.querySelector('iframe')).toBeNull()
      expect(queryByText(/did not respond/i)).not.toBeNull()
    })

    test('a steady heartbeat keeps the iframe alive past the timeout', () => {
      const { container } = renderWithQueries(<OutputFrame html="<b>x</b>" />)
      const iframe = container.querySelector('iframe')!
      // Ping every second for 5s total — longer than the 2.5s timeout. A
      // sliding window must never trip while heartbeats keep coming.
      for (let i = 0; i < 5; i++) {
        act(() => {
          pingFrom(iframe, 80)
          vi.advanceTimersByTime(1_000)
        })
      }
      expect(container.querySelector('iframe')).not.toBeNull()
    })
  })
})

/**
 * Dispatch a `iframe-resize` message that looks like it came from the given
 * iframe's content window (the component checks `event.source`). jsdom doesn't
 * let us set `source` via the MessageEvent ctor, so we patch it on the event.
 */
function pingFrom(iframe: HTMLIFrameElement, height: number) {
  const event = new MessageEvent('message', {
    data: { kind: 'iframe-resize', height },
  })
  Object.defineProperty(event, 'source', { value: iframe.contentWindow })
  window.dispatchEvent(event)
}

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
