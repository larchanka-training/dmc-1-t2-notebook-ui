import { Download } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { exportNotebook } from '../model/export'

// Header-level download menu. Two formats — JSON for a lossless snapshot
// (re-importable later), Markdown for a human-readable copy. The action lives
// in `model/export.ts`; this file is purely the UI surface.
//
// reatomComponent is required because the onClick handlers call `wrap()` at
// render time; `wrap()` itself needs an active reatom context (under
// production `clearStack()`, calling it from a plain React render throws
// "missing async stack").
export const NotebookExportMenu = reatomComponent(() => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon" variant="ghost" aria-label="Download notebook" className="size-8">
            <Download className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={wrap(() => exportNotebook('json'))}>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-semibold">JSON</span>
            <span className="text-[11.5px] text-muted-foreground">Full snapshot</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={wrap(() => exportNotebook('markdown'))}>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-semibold">Markdown</span>
            <span className="text-[11.5px] text-muted-foreground">Human-readable</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}, 'NotebookExportMenu')
