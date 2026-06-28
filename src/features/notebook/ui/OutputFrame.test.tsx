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

  test('delivers user HTML as data (innerHTML), not inlined into the markup (M4)', () => {
    // A model emitting `</main></body>` or a stray <script> must NOT be able to
    // escape the #output-root wrapper and clobber the shell. The user HTML is
    // carried as a JS string the shell assigns to root.innerHTML.
    const evil =
      '</main></body><script>parent.postMessage({kind:"iframe-resize",height:9999},"*")</script>'
    const { container } = render(<OutputFrame html={evil} />)
    const srcDoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? ''
    // #output-root is emitted EMPTY in the markup (user html is not between the tags).
    expect(srcDoc).toContain(
      'id="output-root" style="padding:8px; font-family: system-ui, sans-serif;"></main>',
    )
    // The raw </main>/<script> sequences from the user are escaped (\u003c), so the
    // HTML parser can't act on them; they live only inside the USER_HTML literal.
    expect(srcDoc).not.toContain('</main></body><script>parent.postMessage')
    expect(srcDoc).toContain('USER_HTML')
  })

  test('ignores a resize ping carrying the wrong nonce (M4)', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<OutputFrame html="<b>x</b>" />)
      const iframe = container.querySelector('iframe')!
      // A forged ping (re-executed user script guessing the message shape) with a
      // bogus nonce must not move the frame height.
      act(() => {
        pingFrom(iframe, 300, 'not-the-real-nonce')
        vi.advanceTimersByTime(20)
      })
      expect(iframe.style.height).toBe('80px') // MIN_HEIGHT, unchanged
    } finally {
      vi.useRealTimers()
    }
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

/** Read the per-frame nonce the shell embedded in its srcdoc (TARDIS-168 M4). */
function nonceOf(iframe: HTMLIFrameElement): string {
  const srcDoc = iframe.getAttribute('srcdoc') ?? ''
  return /const NONCE = "([^"]+)"/.exec(srcDoc)?.[1] ?? ''
}

/**
 * Dispatch a `iframe-resize` message that looks like it came from the given
 * iframe's content window (the component checks `event.source`). jsdom doesn't
 * let us set `source` via the MessageEvent ctor, so we patch it on the event.
 * Carries the frame's real nonce so the parent accepts it (a forged ping with a
 * wrong/absent nonce is dropped — see the M4 test).
 */
function pingFrom(iframe: HTMLIFrameElement, height: number, nonce = nonceOf(iframe)) {
  const event = new MessageEvent('message', {
    data: { kind: 'iframe-resize', height, nonce },
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
