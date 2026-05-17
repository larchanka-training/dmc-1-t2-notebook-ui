import { reatomComponent } from '@reatom/react'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { cn } from '@/shared/lib/cn'
import { cellsAtom } from '../model/notebook'

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

export const NotebookOutline = reatomComponent(() => {
  const cells = cellsAtom()

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

  // Earns its 224px only when there's actually something to navigate.
  // A single heading is its own context — the outline doesn't help.
  if (entries.length < 2) return null

  return (
    <aside className="hidden xl:flex w-56 shrink-0 border-l bg-background">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            On this page
          </p>
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => scrollToCell(entry.cellId)}
                  className={cn(
                    'block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground transition-colors',
                    entry.level === 1 && 'font-medium text-foreground',
                    entry.level === 2 && 'pl-3',
                    entry.level === 3 && 'pl-6',
                    entry.level >= 4 && 'pl-9',
                  )}
                  title={entry.text}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </ScrollArea>
    </aside>
  )
}, 'NotebookOutline')
