import { useEffect } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { ChevronDown, ChevronUp, Regex, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/lib/cn'
import { useHotkeys } from '@/shared/lib/hotkeys'
import {
  activeMatchIndexAtom,
  closeSearch,
  matchCountLabelAtom,
  nextMatch,
  prevMatch,
  searchMatchesAtom,
  searchOpenAtom,
  searchQueryAtom,
  setSearchQuery,
  useRegexAtom,
} from '../model/search'

// Bring a cell into view by its `data-cell-id` (also used by the outline).
// Takes the id as an argument — it must NOT read Reatom atoms, because it runs
// from a useEffect, which is outside the Reatom stack; reading an atom there
// throws `missing async stack` under clearStack().
function scrollCellIntoView(cellId: string): void {
  const el = document.querySelector(`[data-cell-id="${cellId}"]`)
  // scrollIntoView is absent in JSDOM and may be missing on non-element nodes.
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
}

/**
 * Inline notebook search, toggled with Cmd/Ctrl+F. Searches cell sources (see
 * model/search), shows an `n/m` counter, navigates with Enter / Shift+Enter,
 * and offers a regex toggle. Escape (while focused) closes it.
 */
export const SearchBar = reatomComponent(() => {
  const open = searchOpenAtom()

  // Cmd/Ctrl+F opens search (and steals the key from the browser find).
  useHotkeys({ 'Mod-f': wrap(() => searchOpenAtom.set(true)) })

  // Resolve the active match's cell id HERE, in the reactive component body
  // where the Reatom stack is active. The effect below only touches the DOM.
  const matches = searchMatchesAtom()
  const activeIndex = activeMatchIndexAtom()
  const activeCellId = open ? matches[activeIndex]?.cellId : undefined
  useEffect(() => {
    if (activeCellId) scrollCellIntoView(activeCellId)
  }, [activeCellId])

  if (!open) return null

  const onNext = wrap(() => nextMatch())
  const onPrev = wrap(() => prevMatch())

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 shadow-sm">
      <Input
        autoFocus
        value={searchQueryAtom()}
        placeholder="Search notebook…"
        className="h-7 w-48 border-0 bg-transparent px-1 text-sm focus-visible:ring-0"
        onChange={wrap((e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value))}
        onKeyDown={wrap((e: React.KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) prevMatch()
            else nextMatch()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            closeSearch()
          }
        })}
      />
      <span className="min-w-[3.5rem] text-center font-mono text-xs text-muted-foreground tabular-nums">
        {matchCountLabelAtom()}
      </span>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Toggle regex"
        aria-pressed={useRegexAtom()}
        className={cn('size-6', useRegexAtom() && 'bg-accent text-accent-foreground')}
        onClick={wrap(() => useRegexAtom.set((v) => !v))}
      >
        <Regex className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Previous match"
        className="size-6"
        onClick={onPrev}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Next match"
        className="size-6"
        onClick={onNext}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Close search"
        className="size-6"
        onClick={wrap(() => closeSearch())}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}, 'SearchBar')
