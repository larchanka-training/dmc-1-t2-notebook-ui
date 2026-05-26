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
// Sizing strategy: a small default height, expanded on demand via the
// content's `document.documentElement.scrollHeight` reported through
// postMessage. Anything bigger than MAX_HEIGHT scrolls inside the frame.

import { useEffect, useRef, useState } from 'react'

const MIN_HEIGHT = 80
const MAX_HEIGHT = 600

interface OutputFrameProps {
  html: string
}

export function OutputFrame({ html }: OutputFrameProps) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)

  // The iframe sends its scrollHeight after load and on every mutation.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return
      const data = event.data as { kind?: string; height?: number } | null
      if (data?.kind === 'iframe-resize' && typeof data.height === 'number') {
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height) + 4)))
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

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
 * Wrap user HTML in a tiny shell that reports its size back to the
 * parent. Keeping the shell minimal: no fonts, no resets — the user's
 * HTML decides how it looks.
 */
function buildSrcDoc(userHtml: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
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
