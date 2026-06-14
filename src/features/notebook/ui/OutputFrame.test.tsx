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

  test('always shows a danger alert that scripts run outside the QuickJS runtime', () => {
    const { getByRole } = render(<OutputFrame html="<b>hi</b>" />)
    const alert = getByRole('alert')
    // The copy must be blunt about the boundary: cell Stop/timeout do not
    // reach iframe scripts. No softening like "sandboxed, so safe".
    expect(alert.textContent).toMatch(/outside the QuickJS runtime/i)
    expect(alert.textContent).toMatch(/Stop and timeout may not stop them/i)
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

describe('OutputFrame — resize sizing', () => {
  test('measures the #output-root wrapper, not the document element', () => {
    const { container } = render(<OutputFrame html="<b>hi</b>" />)
    const srcDoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? ''
    // The shell must measure an intrinsic content wrapper, not the iframe
    // viewport (document.documentElement). Measuring documentElement makes the
    // reported height track the iframe's own height and re-opens the feedback
    // loop this ticket fixes.
    expect(srcDoc).toContain('id="output-root"')
    expect(srcDoc).toContain("getElementById('output-root')")
    expect(srcDoc).not.toContain('document.documentElement.scrollHeight')
  })

  describe('parent height application', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('does not grow when the shell keeps reporting the applied height', () => {
      // Reproduces the TARDIS-66 loop: the shell reports the iframe's own
      // height back on every heartbeat. The old parent added +4 each time, so
      // an idle frame crept up to MAX_HEIGHT. The fix applies the reported
      // value verbatim and ignores no-op updates, so the height must stay put.
      const { container } = render(<OutputFrame html="<b>x</b>" />)
      const iframe = container.querySelector('iframe')!

      // Seed a content height above MIN_HEIGHT so any growth would be visible.
      act(() => {
        pingFrom(iframe, 200)
        vi.advanceTimersByTime(20)
      })
      const settled = iframe.style.height
      expect(settled).toBe('200px')

      // Feed the applied height back repeatedly — the feedback loop itself.
      for (let i = 0; i < 5; i++) {
        act(() => {
          pingFrom(iframe, Number.parseInt(iframe.style.height, 10))
          vi.advanceTimersByTime(20)
        })
      }
      expect(iframe.style.height).toBe(settled)
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
