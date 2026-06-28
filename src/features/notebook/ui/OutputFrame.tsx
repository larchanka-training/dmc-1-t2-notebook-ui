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
// Sizing strategy: a small default height, expanded on demand. The shell
// measures an intrinsic content wrapper (#output-root) — NOT the iframe
// viewport — and reports it through postMessage; the parent applies it
// verbatim (clamped) and ignores no-op updates, so a steady heartbeat at a
// stable size can't inflate the frame. Anything bigger than MAX_HEIGHT scrolls
// inside the frame.

import { useEffect, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

// Random per-frame token. crypto.randomUUID is available in the DOM env; the
// Math.random fallback keeps older test runners happy. Kept out of render (it is
// impure) — called only inside effects / lazy state initialisers.
function makeNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

const MIN_HEIGHT = 80
const MAX_HEIGHT = 600

/**
 * Heartbeat budget. The iframe shell pings on an interval (see buildSrcDoc);
 * the parent kills the frame only after NO ping has arrived for this long.
 *
 * Why a sliding budget and not a one-shot "did it ping once" check: user code
 * can send a single fake `iframe-resize` and then block the thread
 * (`postMessage(...); while(true){}`), which would permanently satisfy a
 * one-shot liveness flag. With a heartbeat, a blocked thread stops pinging and
 * the budget elapses; a legitimately interactive frame (rAF animation,
 * ResizeObserver) keeps pinging and stays alive. The window is generous: this
 * is a "thread is wedged" check, not a performance budget, so a few seconds of
 * heavy synchronous work between heartbeats is tolerated.
 */
const HEARTBEAT_INTERVAL_MS = 1_000
const HEARTBEAT_TIMEOUT_MS = 2_500
/** How often the parent checks whether the last heartbeat is overdue. */
const HEARTBEAT_POLL_MS = 500

interface OutputFrameProps {
  html: string
}

export function OutputFrame({ html }: OutputFrameProps) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  // Mirror of the applied height, used to drop no-op resize pings. A ref (not
  // derived from `height`) so the comparison survives the effect re-running on
  // `html` changes and is readable synchronously inside the message handler.
  const heightRef = useRef(MIN_HEIGHT)
  const [stalled, setStalled] = useState(false)

  // The iframe shell pings its scrollHeight on a heartbeat interval. The
  // parent tracks the time of the LAST ping and declares the frame stuck once
  // no ping has arrived within HEARTBEAT_TIMEOUT_MS — a sliding window, so a
  // single spoofed ping followed by an infinite loop can't keep it alive
  // forever (the loop stops the heartbeat and the window elapses).
  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    // Per-frame nonce tying liveness pings to THIS srcDoc (TARDIS-168 M4).
    // Generated here (not in render, where randomness is impure) and closed over
    // by both the srcDoc shell and the message handler, so they always agree and
    // a stale frame's late messages carry a different nonce.
    const nonce = makeNonce()
    // Assign srcdoc imperatively so the nonce in the document and in the handler
    // come from the same place; rebuilding on every `html` change reloads it.
    iframe.srcdoc = buildSrcDoc(html, nonce)
    // Start the clock at mount: a frame that never pings at all (e.g. it
    // blocks before the shell script runs) must still trip the timeout.
    let lastPing = Date.now()
    // Coalesce height updates: a frame can post `iframe-resize` in a tight
    // loop, and calling setHeight on every message would re-render per message.
    // We keep only the latest height and apply it once per animation frame.
    let pendingHeight: number | null = null
    let frameId: number | null = null
    const handler = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return
      const data = event.data as { kind?: string; height?: number; nonce?: string } | null
      // Drop pings that don't carry this frame's nonce: a re-executed user
      // script can't forge it (it lives in the shell IIFE closure), and a stale
      // frame mid-teardown can't move the live one.
      if (
        data?.kind === 'iframe-resize' &&
        data.nonce === nonce &&
        typeof data.height === 'number'
      ) {
        // Heartbeat is updated on EVERY ping (cheap, before any early return)
        // so the liveness window stays accurate even for no-op resizes.
        lastPing = Date.now()
        // Apply the reported content height verbatim (clamped). No growth fudge
        // factor: adding pixels here would feed back into the next heartbeat
        // and inflate the frame on every tick (the original feedback loop).
        const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height)))
        // Ignore no-op updates: the heartbeat re-pings the same height every
        // second; re-rendering on each would be pure churn.
        if (next === heightRef.current) return
        pendingHeight = next
        if (frameId === null) {
          frameId = requestAnimationFrame(() => {
            frameId = null
            if (pendingHeight !== null) {
              heightRef.current = pendingHeight
              setHeight(pendingHeight)
            }
          })
        }
      }
    }
    window.addEventListener('message', handler)
    const poll = setInterval(() => {
      if (Date.now() - lastPing > HEARTBEAT_TIMEOUT_MS) {
        // Heartbeat overdue => the iframe thread is wedged (likely an infinite
        // loop). Unmounting it below tears down its execution context.
        setStalled(true)
      }
    }, HEARTBEAT_POLL_MS)
    return () => {
      window.removeEventListener('message', handler)
      clearInterval(poll)
      if (frameId !== null) cancelAnimationFrame(frameId)
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
    <div className="flex flex-col gap-2">
      {/*
        Honest danger notice. The iframe runs real browser JS, which lives in
        the browser's iframe lifecycle — NOT the QuickJS runtime. Cell Stop,
        the execution timeout and the output budget do not reach it. Always
        visible (never behind hover/collapse) so the user is never misled into
        thinking this output is governed like cell code.
      */}
      <div
        role="alert"
        className="flex gap-2 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Dangerous HTML output. Scripts in this iframe run outside the QuickJS runtime; notebook
          Stop and timeout may not stop them.
        </span>
      </div>
      {/* srcdoc is assigned imperatively in the effect (with a per-frame nonce);
          re-keyed on `html` so React rebuilds the element for a fresh document. */}
      <iframe
        key={html}
        ref={ref}
        title="cell-html-output"
        sandbox="allow-scripts"
        className="block w-full rounded border border-border bg-background"
        style={{ height }}
      />
    </div>
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
 * Wrap user HTML in a shell-owned element (#output-root) that carries the
 * padding/font defaults and is the single box we measure. html/body stay at
 * margin:0; min-height:0 so the reported value is the intrinsic content height,
 * independent of the iframe viewport. Measuring document.documentElement
 * instead would track the (parent-controlled) viewport height and feed a growth
 * loop: parent enlarges the iframe -> documentElement grows -> next ping
 * reports the larger value -> repeat to MAX_HEIGHT.
 *
 * The shell pings on three triggers: once on load, on every size mutation of
 * the wrapper (ResizeObserver), and on a steady heartbeat interval. The
 * heartbeat is what the parent's liveness watchdog relies on — as long as the
 * iframe's event loop is turning it keeps pinging; a wedged thread (infinite
 * loop) stops, and the parent tears the frame down.
 */
/**
 * Embed an arbitrary string as a JS string literal that cannot break out of the
 * surrounding <script>. JSON.stringify handles quotes/newlines/backslashes;
 * escaping every `<` to its unicode form additionally neutralises `</script>`
 * and `<!--`, the two sequences the HTML parser would otherwise treat as the
 * end of the script element. This is what lets us hand the user HTML to the
 * shell as DATA instead of inlining it into the markup (TARDIS-168 M4).
 */
function toScriptStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function buildSrcDoc(userHtml: string, nonce: string): string {
  // M4 (TARDIS-168): the user HTML is NOT inlined into the markup anymore.
  // Inlining let a model's `</main></body>` or stray <script> escape the
  // #output-root wrapper and clobber the shell's sizing/heartbeat script.
  // Instead the shell owns the whole document and assigns the user HTML to
  // root.innerHTML, so it is structurally confined inside #output-root and can
  // never add siblings to the shell <script>. innerHTML does not run <script>
  // tags, so we re-create them (the contract supports a <canvas> + drawing
  // <script>). The heartbeat/resize closure carries a per-frame nonce the
  // parent checks, so a re-executed user script can't forge a liveness ping
  // (the nonce stays local to the IIFE, out of the global scope user code sees).
  return `<!doctype html>
<html style="margin:0; min-height:0;">
<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${IFRAME_CSP}"></head>
<body style="margin:0; min-height:0;">
<main id="output-root" style="padding:8px; font-family: system-ui, sans-serif;"></main>
<script>
  (function () {
    const NONCE = ${toScriptStringLiteral(nonce)};
    const USER_HTML = ${toScriptStringLiteral(userHtml)};
    const root = document.getElementById('output-root');
    root.innerHTML = USER_HTML;
    // innerHTML-inserted <script> tags are inert; re-create them so a
    // <canvas> + drawing <script> in display() html still runs.
    for (const old of root.querySelectorAll('script')) {
      const s = document.createElement('script');
      for (const attr of old.attributes) s.setAttribute(attr.name, attr.value);
      s.textContent = old.textContent;
      old.replaceWith(s);
    }
    const post = () => parent.postMessage({
      kind: 'iframe-resize',
      nonce: NONCE,
      height: Math.max(root.scrollHeight, root.offsetHeight),
    }, '*');
    post();
    new ResizeObserver(post).observe(root);
    setInterval(post, ${HEARTBEAT_INTERVAL_MS});
  })();
</script>
</body>
</html>`
}
