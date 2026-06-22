import { useEffect, useRef } from 'react'
import { ArrowLeft, BookText } from 'lucide-react'

// 404 page ported from new-design-v2/404.html (TARDIS-167 №14). The "0" in 404
// is a pair of googly eyes that track the cursor; copy is in English per the UI
// language policy. Standalone — NOT behind the auth wall (a wrong URL must be
// reachable signed-out too); rendered by the root route when no child matches.
const HOME_PATH = import.meta.env.BASE_URL

export default function NotFoundPage() {
  const eyesRef = useRef<HTMLSpanElement>(null)

  // Pupils follow the cursor. Pure DOM (no React state) so the rAF loop never
  // re-renders; cleaned up on unmount.
  useEffect(() => {
    const root = eyesRef.current
    if (!root) return
    const eyes = Array.from(root.querySelectorAll<HTMLElement>('.eye'))
    if (eyes.length === 0) return

    let targetX = window.innerWidth / 2
    let targetY = 0
    let frame = 0

    const render = () => {
      frame = 0
      for (const eye of eyes) {
        const pupil = eye.firstElementChild as HTMLElement | null
        if (!pupil) continue
        const r = eye.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const angle = Math.atan2(targetY - cy, targetX - cx)
        const max = (r.width / 2 - pupil.offsetWidth / 2) * 0.92
        const px = Math.cos(angle) * max
        const py = Math.sin(angle) * max
        pupil.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`
      }
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(render)
    }
    const onMove = (e: PointerEvent) => {
      targetX = e.clientX
      targetY = e.clientY
      schedule()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('resize', schedule)
    render()
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
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
            ref={eyesRef}
            className="inline-flex select-none items-center font-mono text-[88px] leading-none font-bold tracking-[-0.04em] sm:text-[112px]"
            aria-label="404"
          >
            <span aria-hidden="true">4</span>
            <span
              className="mx-[0.03em] box-border inline-flex h-[0.8em] w-[0.66em] items-center justify-center gap-[0.04em] rounded-full border-[0.1em] border-foreground align-baseline"
              aria-hidden="true"
            >
              <span className="relative h-[0.2em] w-[0.2em] rounded-full bg-white shadow-[inset_0_0_0_0.012em_rgb(0_0_0/0.12)]">
                <span className="absolute top-1/2 left-1/2 h-[0.1em] w-[0.1em] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#15110e]" />
              </span>
              <span className="relative h-[0.2em] w-[0.2em] rounded-full bg-white shadow-[inset_0_0_0_0.012em_rgb(0_0_0/0.12)]">
                <span className="absolute top-1/2 left-1/2 h-[0.1em] w-[0.1em] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#15110e]" />
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
