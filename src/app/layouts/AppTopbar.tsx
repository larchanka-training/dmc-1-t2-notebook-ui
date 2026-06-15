import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Hash, PanelLeft, Search } from 'lucide-react'
import {
  NotebookToolbar,
  SaveIndicator,
  SyncIndicator,
  outlineVisibleAtom,
  outlineDrawerOpenAtom,
  runAll,
  searchOpenAtom,
} from '@/features/notebook'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { useSidebar } from '@/shared/ui/sidebar'
import { useHotkeys } from '@/shared/lib/hotkeys'
import { useIsMobile } from '@/shared/lib/use-mobile'
import { cn } from '@/shared/lib/cn'

// The notebook lives at the app base path (notebookRoute path = '' under the
// base-prefixed root route), so it is active when the URL is exactly the base.
const HOME_PATH = import.meta.env.BASE_URL

/**
 * Notebook-specific topbar controls: autosave status, a search trigger, the
 * outline toggle, and the run/kernel toolbar. Rendered only on the notebook
 * route (the controls are meaningless on /about, /login, …), so its Run All
 * hotkey is likewise scoped to where a notebook exists.
 */
const NotebookTopbarControls = reatomComponent(() => {
  // The outline toggle drives different state per layout: the inline column's
  // visibility on wide screens, the floating drawer's open state on narrow
  // ones (≤1280px). `aria-pressed` reflects whichever applies.
  const isNarrow = useIsMobile()
  const outlineVisible = outlineVisibleAtom()
  const outlineDrawerOpen = outlineDrawerOpenAtom()
  const outlineActive = isNarrow ? outlineDrawerOpen : outlineVisible
  const toggleOutline = wrap(() => {
    if (isNarrow) outlineDrawerOpenAtom.set((v) => !v)
    else outlineVisibleAtom.set((v) => !v)
  })

  // Run All from anywhere in the notebook. As a Mod- combo it is intentionally
  // NOT blocked while typing in a cell (see hotkeys.ts `blockedByEditor`); the
  // markdown textarea explicitly lets this combo bubble (NotebookCell.tsx).
  useHotkeys({ 'Mod-Shift-Enter': wrap(() => runAll()) })

  return (
    <>
      <SaveIndicator />
      {/* Remote-sync status (#135): on-device save state (SaveIndicator) and
          server-sync state (SyncIndicator) are distinct signals, shown together. */}
      <SyncIndicator />

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Search notebook"
              className="size-9 text-muted-foreground"
              onClick={wrap(() => searchOpenAtom.set(true))}
            >
              <Search className="size-[18px]" />
            </Button>
          }
        />
        <TooltipContent>Search notebook (⌘F)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Toggle outline"
              aria-pressed={outlineActive}
              className={cn(
                'size-9 text-muted-foreground',
                outlineActive && 'bg-primary/10 text-primary',
              )}
              onClick={toggleOutline}
            >
              <Hash className="size-[18px]" />
            </Button>
          }
        />
        <TooltipContent>Toggle outline</TooltipContent>
      </Tooltip>

      <div className="h-6 w-px bg-border" aria-hidden="true" />

      <NotebookToolbar />
    </>
  )
}, 'NotebookTopbarControls')

/**
 * Global application topbar (60px). The sidebar toggle is always present; the
 * notebook controls are mounted only on the notebook route (Variant A).
 */
export const AppTopbar = reatomComponent(() => {
  const { toggleSidebar } = useSidebar()
  const isNotebook = urlAtom().pathname === HOME_PATH

  // `Mod-\` toggles the sidebar (the shadcn primitive keeps its own `Mod-B`).
  // toggleSidebar is plain React state, so no `wrap` is needed here.
  useHotkeys({ 'Mod-\\': () => toggleSidebar() })

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-border bg-background/80 px-4 backdrop-blur-sm">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Toggle sidebar"
              className="size-9 text-muted-foreground"
              onClick={() => toggleSidebar()}
            >
              <PanelLeft className="size-[18px]" />
            </Button>
          }
        />
        <TooltipContent>Toggle sidebar (⌘\)</TooltipContent>
      </Tooltip>

      <div className="h-6 w-px bg-border" aria-hidden="true" />

      {isNotebook ? <NotebookTopbarControls /> : <div className="flex-1" />}
    </header>
  )
}, 'AppTopbar')
