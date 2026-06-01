import { action, atom, computed } from '@reatom/core'
import { cellsAtom } from './notebook'

// Notebook-wide search over cell sources. Unlike the browser's Ctrl+F (which
// only sees rendered DOM and misses collapsed outputs / non-active editors),
// this searches the underlying `source` of every cell, so matches in cells
// you haven't scrolled to are still found.

export interface SearchMatch {
  cellId: string
  /** Character offset of the match within the cell source. */
  index: number
  length: number
}

export const searchOpenAtom = atom(false, 'notebook.search.open')
export const searchQueryAtom = atom('', 'notebook.search.query')
export const useRegexAtom = atom(false, 'notebook.search.useRegex')
export const activeMatchIndexAtom = atom(0, 'notebook.search.activeIndex')

// Build a global matcher from the query. Plain queries are case-insensitive
// substring search; regex mode compiles the query (invalid regex → no matches
// rather than a thrown error, so typing a half-written pattern is harmless).
function buildMatcher(query: string, useRegex: boolean): RegExp | null {
  if (query.length === 0) return null
  try {
    const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(source, 'gi')
  } catch {
    return null
  }
}

export const searchMatchesAtom = computed<SearchMatch[]>(() => {
  const matcher = buildMatcher(searchQueryAtom(), useRegexAtom())
  if (!matcher) return []
  const matches: SearchMatch[] = []
  for (const cell of cellsAtom()) {
    const source = cell.code()
    matcher.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = matcher.exec(source))) {
      // Skip zero-length matches (e.g. regex `a*`, `^`, `$`) BEFORE recording:
      // they have no visible span to highlight or scroll to, but would still
      // inflate the counter and create phantom navigation stops. Bumping
      // lastIndex also breaks the otherwise-infinite loop on an empty match.
      if (m[0].length === 0) {
        matcher.lastIndex++
        continue
      }
      matches.push({ cellId: cell.id, index: m.index, length: m[0].length })
    }
  }
  return matches
}, 'notebook.search.matches')

// The currently-navigated match, clamped to the live result set. The active
// INDEX is not reset when a live edit shrinks the results (the cell editor and
// the counter both read this), so selecting `matches[index]` raw can land on
// `undefined`. Clamping here keeps the counter, the highlight and the scroll
// target on one real match. Returns null only when there are no matches.
export const activeMatchAtom = computed<SearchMatch | null>(() => {
  const all = searchMatchesAtom()
  if (all.length === 0) return null
  const i = Math.min(activeMatchIndexAtom(), all.length - 1)
  return all[i] ?? null
}, 'notebook.search.activeMatch')

/** 1-based position of the active match, or 0 when there are none. */
export const matchCountLabelAtom = computed(() => {
  const total = searchMatchesAtom().length
  if (total === 0) return '0/0'
  const active = Math.min(activeMatchIndexAtom(), total - 1)
  return `${active + 1}/${total}`
}, 'notebook.search.countLabel')

export const openSearch = action(() => {
  searchOpenAtom.set(true)
}, 'notebook.search.open.action')

export const closeSearch = action(() => {
  searchOpenAtom.set(false)
  searchQueryAtom.set('')
  activeMatchIndexAtom.set(0)
}, 'notebook.search.close.action')

export const setSearchQuery = action((query: string) => {
  searchQueryAtom.set(query)
  activeMatchIndexAtom.set(0)
}, 'notebook.search.setQuery')

function step(delta: 1 | -1): void {
  const total = searchMatchesAtom().length
  if (total === 0) return
  const next = (activeMatchIndexAtom() + delta + total) % total
  activeMatchIndexAtom.set(next)
}

export const nextMatch = action(() => step(1), 'notebook.search.next')
export const prevMatch = action(() => step(-1), 'notebook.search.prev')
