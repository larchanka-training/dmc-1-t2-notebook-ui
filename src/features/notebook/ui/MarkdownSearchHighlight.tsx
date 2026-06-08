import { reatomComponent } from '@reatom/react'
import { cn } from '@/shared/lib/cn'
import { activeMatchAtom, searchMatchesAtom, searchOpenAtom } from '../model/search'

interface MarkdownSearchHighlightProps {
  cellId: string
  source: string
}

// Backdrop layer that paints notebook-search matches BEHIND the markdown
// textarea. A native <textarea> can't render <mark> inside itself, so we mirror
// its text in an absolutely-positioned layer with the SAME typography/padding,
// draw the match backgrounds there, and keep the textarea on top with a
// transparent background so the highlights show through under the real text.
//
// Isolated in its own reatomComponent for the same reason as CodeCellEditor:
// search results change on every keystroke in the search bar; subscribing here
// (not in the cell row) keeps that re-render off the whole cell.
export const MarkdownSearchHighlight = reatomComponent<MarkdownSearchHighlightProps>(
  ({ cellId, source }) => {
    if (!searchOpenAtom()) return null
    const all = searchMatchesAtom()
    const mine = all.filter((m) => m.cellId === cellId)
    if (mine.length === 0) return null

    // Clamped active match (shared with the search bar / code cells): the one
    // the user navigated to gets a stronger highlight than the rest.
    const activeMatch = activeMatchAtom()

    // Split the source into alternating plain-text and <mark> segments. Matches
    // arrive in document order (the search scans left-to-right), so a single
    // forward cursor over the string is enough.
    const parts: React.ReactNode[] = []
    let cursor = 0
    mine.forEach((m, i) => {
      if (m.index < cursor) return // defensive: skip any overlap
      if (m.index > cursor) parts.push(source.slice(cursor, m.index))
      parts.push(
        <mark
          key={i}
          className={cn(
            'rounded-[2px] bg-[color-mix(in_oklab,var(--primary)_22%,transparent)] text-transparent',
            m === activeMatch &&
              'bg-[color-mix(in_oklab,var(--primary)_42%,transparent)] outline outline-1 outline-[var(--primary)]',
          )}
        >
          {source.slice(m.index, m.index + m.length)}
        </mark>,
      )
      cursor = m.index + m.length
    })
    parts.push(source.slice(cursor))

    // Must mirror the textarea's box model exactly (p-4, font, leading,
    // wrapping) so the painted backgrounds line up with the typed glyphs.
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden p-4 font-sans text-base leading-relaxed whitespace-pre-wrap break-words text-transparent select-none"
      >
        {parts}
      </div>
    )
  },
  'MarkdownSearchHighlight',
)
