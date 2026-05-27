// Sandboxed iframe for rendering arbitrary HTML produced by user code via
// `display({ type: 'html', value: '...' })`.
//
// Why an iframe and not dangerouslySetInnerHTML:
//   - Scripts inside the snippet must NOT touch the parent document, its
//     cookies, its event listeners, or anything else outside the frame.
//   - We need an isolated DOM so styling tags (e.g. <style>) don't leak.
//   - `sandbox="allow-scripts"` (without `allow-same-origin`) gives the
//     iframe a unique origin: it can run scripts, but cannot read the
//     parent's storage, perform same-origin XHR, etc.
//
// Two extra guards close the gap that a bare `allow-scripts` iframe is still
// a full browser runtime (it does NOT obey the QuickJS interrupt / Stop /
// timeout / output budget that govern cell code):
//   1. A CSP <meta> with `default-src 'none'` blocks network access
//      (connect-src, fetch/XHR/WebSocket/beacon, remote scripts, sub-frames)
//      while still allowing inline script/style and data:/blob: images, so
//      Canvas/SVG/JS visualisations keep working but cannot exfiltrate data.
//   2. A watchdog: the shell pings the parent right after parse. If no ping
//      arrives within WATCHDOG_MS the script is assumed stuck (e.g.
//      `while(true){}`), and we unmount the iframe — which tears down its
//      execution context — and show a notice instead.
//
// Sizing strategy: a small default height, expanded on demand via the
// content's `document.documentElement.scrollHeight` reported through
// postMessage. Anything bigger than MAX_HEIGHT scrolls inside the frame.

import { useEffect, useRef, useState } from 'react'

const MIN_HEIGHT = 80
const MAX_HEIGHT = 600

/**
 * How long to wait for the iframe's first ping before declaring it stuck.
 * Generous: this is a liveness check ("did the script respond at all"), not
 * a performance budget. A non-JS / well-behaved snippet pings immediately.
 */
const WATCHDOG_MS = 2_000

interface OutputFrameProps {
  html: string
}

export function OutputFrame({ html }: OutputFrameProps) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [stalled, setStalled] = useState(false)

  // The iframe sends its scrollHeight after load and on every mutation.
  // The first message also clears the watchdog (proves the script is alive).
  useEffect(() => {
    let alive = false
    const handler = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return
      const data = event.data as { kind?: string; height?: number } | null
      if (data?.kind === 'iframe-resize' && typeof data.height === 'number') {
        alive = true
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height) + 4)))
      }
    }
    window.addEventListener('message', handler)
    const watchdog = setTimeout(() => {
      // No ping => the iframe script never yielded (likely an infinite loop).
      // Unmounting it below kills its execution context.
      if (!alive) setStalled(true)
    }, WATCHDOG_MS)
    return () => {
      window.removeEventListener('message', handler)
      clearTimeout(watchdog)
    }
  }, [html])

  if (stalled) {
    return (
      <div className="rounded border border-amber-500/60 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
        HTML output stopped: the embedded script did not respond (possible infinite loop).
      </div>
    )
  }

  return (
    <iframe
      ref={ref}
      title="cell-html-output"
      sandbox="allow-scripts"
      srcDoc={buildSrcDoc(html)}
      className="block w-full rounded border border-border bg-background"
      style={{ height }}
    />
  )
}

/**
 * Inline CSP for the iframe document. `default-src 'none'` is the backstop:
 * everything not explicitly re-allowed (most importantly `connect-src`, so
 * fetch/XHR/WebSocket/sendBeacon and remote scripts) is denied. We re-allow
 * only what a self-contained visualisation needs: inline script/style and
 * data:/blob: images.
 */
const IFRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"

/**
 * Wrap user HTML in a tiny shell that reports its size back to the
 * parent. Keeping the shell minimal: no fonts, no resets — the user's
 * HTML decides how it looks.
 */
function buildSrcDoc(userHtml: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${IFRAME_CSP}"></head>
<body style="margin:0; padding:8px; font-family: system-ui, sans-serif;">
${userHtml}
<script>
  const post = () => parent.postMessage({
    kind: 'iframe-resize',
    height: document.documentElement.scrollHeight,
  }, '*');
  post();
  new ResizeObserver(post).observe(document.documentElement);
</script>
</body>
</html>`
}
