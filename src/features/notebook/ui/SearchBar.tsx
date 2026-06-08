import { useEffect, useRef } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/lib/cn'
import { useHotkeys } from '@/shared/lib/hotkeys'
import {
  activeMatchAtom,
  caseSensitiveAtom,
  closeSearch,
  matchCountLabelAtom,
  nextMatch,
  prevMatch,
  searchOpenAtom,
  searchQueryAtom,
  setSearchQuery,
  useRegexAtom,
} from '../model/search'

// Bring a cell into view by its `data-cell-id` (also used by the outline).
// Takes the id as an argument — it must NOT read Reatom atoms, because it runs
// from a useEffect, which is outside the Reatom stack; reading an atom there
// throws `missing async stack` under clearStack().
// Active look for the Aa / regex toggles (new-design-v2 search opt): a soft
// primary tint + primary text, NOT the near-invisible shadcn `accent`.
const TOGGLE_ACTIVE = 'bg-[color-mix(in_oklch,var(--primary)_16%,transparent)] text-primary'

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
  // Overlay stays mounted so it can fade/slide out on close; we focus the
  // input via the container ref (the Input primitive doesn't forward a ref).
  const overlayRef = useRef<HTMLDivElement>(null)

  // Cmd/Ctrl+F opens search (and steals the key from the browser find).
  useHotkeys({ 'Mod-f': wrap(() => searchOpenAtom.set(true)) })

  // Resolve the active match's cell id HERE, in the reactive component body
  // where the Reatom stack is active. The effect below only touches the DOM.
  // `activeMatchAtom` is clamped to the live results, so a live edit that
  // shrinks the match set can't leave us pointing at a stale/undefined match.
  const activeCellId = open ? activeMatchAtom()?.cellId : undefined
  useEffect(() => {
    if (activeCellId) scrollCellIntoView(activeCellId)
  }, [activeCellId])

  // Focus the field when the overlay opens (replaces autoFocus, which only
  // fires on mount and the overlay no longer unmounts).
  useEffect(() => {
    if (open) overlayRef.current?.querySelector('input')?.focus()
  }, [open])

  const onNext = wrap(() => nextMatch())
  const onPrev = wrap(() => prevMatch())

  return (
    <div
      ref={overlayRef}
      role="search"
      aria-hidden={!open}
      className={cn(
        'fixed left-1/2 top-3 z-50 flex w-[min(520px,80vw)] -translate-x-1/2 items-center gap-1.5 rounded-[10px] border border-border bg-card py-1.5 pl-3 pr-2 shadow-[var(--shadow-pop)] transition-[opacity,transform] duration-150 ease-out',
        open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <Input
        tabIndex={open ? undefined : -1}
        value={searchQueryAtom()}
        placeholder="Find in notebook…"
        className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
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
        aria-label="Match case"
        aria-pressed={caseSensitiveAtom()}
        className={cn('size-6', caseSensitiveAtom() && TOGGLE_ACTIVE)}
        onClick={wrap(() => caseSensitiveAtom.set((v) => !v))}
      >
        <CaseSensitive className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Toggle regex"
        aria-pressed={useRegexAtom()}
        className={cn('size-6', useRegexAtom() && TOGGLE_ACTIVE)}
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
