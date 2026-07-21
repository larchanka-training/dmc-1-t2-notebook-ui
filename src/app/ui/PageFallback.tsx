import { Loader2 } from 'lucide-react'

/**
 * Loading fallback shown while a lazily-loaded route page chunk is fetched
 * (route-level code splitting, see `lazyRoutePage`). Fills the routed content
 * area of `AppLayout` and centres a spinner, so a slow chunk load reads as
 * "page is loading" rather than a blank shell.
 */
export function PageFallback() {
  return (
    <div
      className="flex min-h-[60vh] w-full items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
