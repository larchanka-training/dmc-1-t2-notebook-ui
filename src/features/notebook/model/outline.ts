import { computed } from '@reatom/core'
import { cellsAtom } from './notebook'

// A single navigable heading pulled from a markdown cell's source.
export interface OutlineEntry {
  cellId: string
  level: number
  text: string
  key: string
}

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/gm

// All markdown headings across the notebook, in document order. Derived from
// cell source so it stays live as the user types. Single source of truth shared
// by the outline pane (what to render) and the editor column (whether to widen
// when the outline is hidden) — see NotebookOutline / NotebookView.
export const outlineEntriesAtom = computed<OutlineEntry[]>(() => {
  const entries: OutlineEntry[] = []
  for (const cell of cellsAtom()) {
    if (cell.kind !== 'markdown') continue
    const text = cell.code()
    let match: RegExpExecArray | null
    HEADING_REGEX.lastIndex = 0
    while ((match = HEADING_REGEX.exec(text))) {
      entries.push({
        cellId: cell.id,
        level: match[1].length,
        text: match[2],
        key: `${cell.id}:${match.index}`,
      })
    }
  }
  return entries
}, 'notebook.outlineEntries')

// The outline earns its space only with something to navigate. A single heading
// is its own context, so it takes ≥ 2 to show the pane (and, on wide layouts,
// to keep the editor column at its narrower width).
export const hasOutlineAtom = computed(
  () => outlineEntriesAtom().length >= 2,
  'notebook.hasOutline',
)
