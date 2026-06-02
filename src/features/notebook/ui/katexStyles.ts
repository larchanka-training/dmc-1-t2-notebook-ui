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

// Inline TeX math per remark-math's rule: a `$`, a non-space, then any run
// closing on a non-space `$`. The leading/trailing non-space requirement is
// what separates real math (`$e^{i\pi}$`) from prose with currency
// (`costs $5 and $10`, which has no space-free `$…$` span).
const INLINE_MATH = /\$[^\s$](?:[^$]*[^\s$])?\$/

/**
 * Cheap pre-check: does the source plausibly contain TeX math delimiters?
 *
 * A bare `$` (e.g. a price) must NOT trigger the lazy KaTeX CSS load, since
 * `remark-math` would not render anything. We match block math (`$$…$$`) or a
 * space-free inline `$…$` span. This is a heuristic, not a full parser: the
 * cost of a rare miss is only unstyled math, and of a rare extra match only a
 * one-time ~23 KB CSS load — both harmless.
 */
export function hasMathDelimiter(source: string): boolean {
  return source.includes('$$') || INLINE_MATH.test(source)
}
