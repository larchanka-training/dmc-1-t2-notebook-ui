import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Hash, PanelLeft, Search } from 'lucide-react'
import {
  NotebookToolbar,
  SaveIndicator,
  outlineVisibleAtom,
  runAll,
  searchOpenAtom,
} from '@/features/notebook'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { useSidebar } from '@/shared/ui/sidebar'
import { useHotkeys } from '@/shared/lib/hotkeys'
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
  const outlineVisible = outlineVisibleAtom()

  // Run All from anywhere in the notebook. As a Mod- combo it is intentionally
  // NOT blocked while typing in a cell (see hotkeys.ts `blockedByEditor`); the
  // markdown textarea explicitly lets this combo bubble (NotebookCell.tsx).
  useHotkeys({ 'Mod-Shift-Enter': wrap(() => runAll()) })

  return (
    <>
      <SaveIndicator />

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
              aria-pressed={outlineVisible}
              className={cn(
                'size-9 text-muted-foreground',
                outlineVisible && 'bg-primary/10 text-primary',
              )}
              onClick={wrap(() => outlineVisibleAtom.set((v) => !v))}
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
    <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b bg-background/80 px-4 backdrop-blur-sm">
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
