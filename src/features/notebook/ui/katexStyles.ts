// KaTeX ships ~23 KB of CSS that is only needed once a notebook actually
// contains math. We load it lazily on the first markdown cell that has a `$`,
// so notebooks without formulas never pay for it. The dynamic import is
// idempotent — the browser/Vite caches the module, and the guard avoids
// scheduling repeat imports.
let loaded = false

export function ensureKatexStyles(): void {
  if (loaded) return
  loaded = true
  // Vite resolves this to a style-injecting chunk; failure is non-fatal
  // (math just renders unstyled), so we swallow the rejection.
  void import('katex/dist/katex.min.css').catch(() => {
    loaded = false
  })
}

/** Cheap pre-check: does the source plausibly contain TeX math delimiters? */
export function hasMathDelimiter(source: string): boolean {
  return source.includes('$')
}
