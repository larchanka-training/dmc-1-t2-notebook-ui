import { useEffect, useState } from 'react'
import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@/shared/ui/sheet'
import { useIsMobile } from '@/shared/lib/use-mobile'
import { cn } from '@/shared/lib/cn'
import { cellsAtom } from '../model/notebook'
import { outlineVisibleAtom, outlineDrawerOpenAtom } from '../model/notebookSettings'

interface OutlineEntry {
  cellId: string
  level: number
  text: string
  key: string
}

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*$/gm

function scrollToCell(cellId: string) {
  const el = document.querySelector<HTMLElement>(`[data-cell-id="${cellId}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Track which heading's cell is currently nearest the top of the viewport, so
// the matching outline entry can be highlighted while the user scrolls. Uses
// IntersectionObserver (the plan's suggested mechanism): the last cell whose
// top crossed the upper third of the viewport wins.
function useActiveCellId(entries: OutlineEntry[]): string | null {
  const [activeCellId, setActiveCellId] = useState<string | null>(null)
  // A stable key of the observed cells: re-run only when the set changes,
  // not on every keystroke that returns a new array of equal ids.
  const cellIdsKey = entries.map((e) => e.cellId).join('|')

  useEffect(() => {
    const ids = cellIdsKey ? cellIdsKey.split('|') : []
    if (ids.length === 0) return
    const els = ids
      .map((id) => document.querySelector<HTMLElement>(`[data-cell-id="${id}"]`))
      .filter((el): el is HTMLElement => el != null)
    if (els.length === 0) return

    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const id = record.target.getAttribute('data-cell-id')
          if (!id) continue
          if (record.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        // Highlight the first heading-cell currently in view, falling back to
        // the last one above the fold so something stays active while scrolling.
        const firstVisible = ids.find((id) => visible.has(id))
        if (firstVisible) setActiveCellId(firstVisible)
      },
      // Bias toward the top: a cell counts as active once it reaches the upper
      // portion of the viewport.
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [cellIdsKey])

  return activeCellId
}

function collectEntries(cells: ReturnType<typeof cellsAtom>): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  for (const cell of cells) {
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
}

// Presentational list of headings, shared by the wide sticky column and the
// narrow drawer. `onNavigate` lets the drawer close itself after a jump.
const OutlineList = reatomComponent<{
  entries: OutlineEntry[]
  onNavigate?: () => void
}>(({ entries, onNavigate }) => {
  const activeCellId = useActiveCellId(entries)
  return (
    <div className="space-y-3 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-1">
        {entries.map((entry) => {
          const isActive = entry.cellId === activeCellId
          return (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => {
                  scrollToCell(entry.cellId)
                  onNavigate?.()
                }}
                className={cn(
                  'block w-full truncate rounded-[var(--radius-item)] px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  entry.level === 1 && 'font-medium text-foreground',
                  entry.level === 2 && 'pl-4',
                  entry.level === 3 && 'pl-6',
                  entry.level >= 4 && 'pl-8',
                  isActive &&
                    'bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] font-semibold text-primary',
                )}
                title={entry.text}
              >
                {entry.text}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}, 'OutlineList')

export const NotebookOutline = reatomComponent(() => {
  const cells = cellsAtom()
  const isNarrow = useIsMobile()
  const visible = outlineVisibleAtom()
  const drawerOpen = outlineDrawerOpenAtom()

  const entries = collectEntries(cells)
  // Earns its space only when there's actually something to navigate. A single
  // heading is its own context — the outline doesn't help.
  const hasOutline = entries.length >= 2

  // Narrow layout (≤1280px): a floating drawer over a scrim, driven by the
  // topbar toggle. Stays mounted so it can animate; renders nothing when there
  // are too few headings.
  if (isNarrow) {
    if (!hasOutline) return null
    return (
      <Sheet
        open={drawerOpen}
        onOpenChange={wrap((open: boolean) => outlineDrawerOpenAtom.set(open))}
      >
        <SheetContent side="right" className="w-(--outline-width) p-0 sm:max-w-none">
          <SheetTitle className="sr-only">Outline</SheetTitle>
          <ScrollArea className="h-full pt-8">
            <OutlineList
              entries={entries}
              onNavigate={wrap(() => outlineDrawerOpenAtom.set(false))}
            />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    )
  }

  // Wide layout (>1280px): a floating card that hugs its content (self-start,
  // not a full-height column), sticky near the top. Hidden when the user
  // collapses it from the topbar or there's nothing to show.
  if (!visible || !hasOutline) return null
  return (
    <aside
      data-slot="outline-pane"
      className="sticky top-0 w-(--outline-width) shrink-0 self-start py-4 pr-4"
    >
      <div className="max-h-[calc(100vh-5.75rem)] overflow-y-auto rounded-[var(--radius-card)] border border-border bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] shadow-[var(--shadow-pop)]">
        <OutlineList entries={entries} />
      </div>
    </aside>
  )
}, 'NotebookOutline')
