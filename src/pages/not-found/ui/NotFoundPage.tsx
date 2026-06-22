import { useEffect, useRef, type CSSProperties } from 'react'
import { ArrowLeft, BookText } from 'lucide-react'

// 404 page ported pixel-for-pixel from new-design-v2/404.html (TARDIS-167 №14).
// The "0" in 404 is a pair of googly eyes whose pupils track the cursor, with an
// occasional blink. Copy is in English per the UI language policy. Standalone —
// NOT behind the auth wall (a wrong URL must be reachable signed-out); rendered
// by the root route when no child route matches.
const HOME_PATH = import.meta.env.BASE_URL

// Sizes are in `em` (relative to the 404 font-size), exactly like the prototype,
// so the eyes scale with the responsive 88px→112px glyph.
const EYE_ZERO: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.04em',
  width: '0.66em',
  height: '0.8em',
  margin: '0 0.03em',
  boxSizing: 'border-box',
  border: '0.1em solid var(--foreground)',
  borderRadius: '50%',
  verticalAlign: 'baseline',
}
const EYE: CSSProperties = {
  position: 'relative',
  width: '0.2em',
  height: '0.2em',
  borderRadius: '50%',
  background: '#fbfbf9',
  boxShadow: 'inset 0 0 0 0.012em rgb(0 0 0 / 0.12)',
  transition: 'transform 0.1s ease',
}
const PUPIL: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: '0.1em',
  height: '0.1em',
  borderRadius: '50%',
  background: '#15110e',
  transform: 'translate(-50%, -50%)',
  transition: 'transform 0.06s linear',
}

export default function NotFoundPage() {
  const zeroRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const zero = zeroRef.current
    if (!zero) return
    const eyes = Array.from(zero.querySelectorAll<HTMLElement>('[data-eye]'))
    if (eyes.length === 0) return

    let targetX = window.innerWidth / 2
    let targetY = 0
    let raf = 0

    const render = () => {
      raf = 0
      for (const eye of eyes) {
        const pupil = eye.firstElementChild as HTMLElement | null
        if (!pupil) continue
        const r = eye.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const ang = Math.atan2(targetY - cy, targetX - cx)
        const max = (r.width / 2 - pupil.offsetWidth / 2) * 0.92
        const px = Math.cos(ang) * max
        const py = Math.sin(ang) * max
        pupil.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`
      }
    }
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(render)
    }
    const onMove = (e: PointerEvent) => {
      targetX = e.clientX
      targetY = e.clientY
      schedule()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('resize', schedule)
    render()

    // Occasional blink: briefly squash the eyeballs (the prototype's .blink).
    let blinkTimer = 0
    let unblinkTimer = 0
    const blink = () => {
      blinkTimer = window.setTimeout(
        () => {
          for (const eye of eyes) eye.style.transform = 'scaleY(0.12)'
          unblinkTimer = window.setTimeout(() => {
            for (const eye of eyes) eye.style.transform = ''
          }, 150)
          blink()
        },
        2400 + Math.random() * 3600,
      )
    }
    blink()

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
      clearTimeout(blinkTimer)
      clearTimeout(unblinkTimer)
    }
  }, [])

  // The path the visitor actually tried to reach (path + query).
  const requestedPath =
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'

  return (
    <div className="grid min-h-full place-items-center px-5 py-10">
      <div className="w-full max-w-[640px]">
        {/* 404 with googly eyes for the "0" */}
        <div className="mb-3 flex items-baseline gap-4">
          <span
            ref={zeroRef}
            className="inline-flex select-none items-center font-mono text-[88px] leading-none font-bold text-foreground sm:text-[112px]"
            style={{ fontFeatureSettings: '"ss03"', letterSpacing: '-0.04em' }}
            aria-label="404"
          >
            <span aria-hidden="true">4</span>
            <span style={EYE_ZERO} aria-hidden="true">
              <span data-eye style={EYE}>
                <span style={PUPIL} />
              </span>
              <span data-eye style={EYE}>
                <span style={PUPIL} />
              </span>
            </span>
            <span aria-hidden="true">4</span>
          </span>
        </div>

        <h1 className="mb-2 text-[26px] font-semibold tracking-tight sm:text-[30px]">
          Page not found
        </h1>
        <p className="mb-6 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
          This page doesn’t exist — the address may have a typo or the link is out of date.
        </p>

        {/* the requested URL */}
        <div className="mb-7 flex h-11 items-center gap-2.5 rounded-[var(--radius-cell)] border border-border bg-card px-3.5">
          <span className="shrink-0 font-mono text-[13px] text-muted-foreground">requested:</span>
          <span className="truncate font-mono text-[13px] text-destructive">{requestedPath}</span>
        </div>

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={HOME_PATH}
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-item)] bg-primary px-4 text-[14px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            <BookText className="size-4" />
            Notebook
          </a>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-item)] px-4 text-[14px] font-medium text-muted-foreground transition hover:bg-muted"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
        </div>
      </div>
    </div>
  )
}
