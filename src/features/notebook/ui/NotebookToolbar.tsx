import { ListOrdered, PlayCircle, RotateCcw, SkipForward, StopCircle } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import {
  restartKernel,
  resumeQueue,
  runAll,
  runtimeStatusAtom,
  skippedCellsAtom,
  stopAll,
} from '../model/runtime'
import { lineNumbersAtom } from '../model/notebookSettings'

/**
 * Notebook-wide control bar: line-numbers toggle, Continue, Restart Kernel,
 * and a single Run All / Stop button that flips to a red Stop while the kernel
 * is busy (new-design-v2 — there is no separate Stop All button).
 * Mounted in the global topbar.
 */
export const NotebookToolbar = reatomComponent(() => {
  const isBusy = runtimeStatusAtom() === 'busy'
  const canResume = !isBusy && skippedCellsAtom().length > 0
  const lineNumbers = lineNumbersAtom()

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Toggle line numbers"
              aria-pressed={lineNumbers}
              className={cn('size-8', lineNumbers && 'bg-accent text-accent-foreground')}
              onClick={wrap(() => lineNumbersAtom.set((v) => !v))}
            >
              <ListOrdered className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Toggle line numbers</TooltipContent>
      </Tooltip>
      {canResume && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={wrap(() => resumeQueue())}
              >
                <SkipForward className="size-4" />
                Continue
              </Button>
            }
          />
          <TooltipContent>Resume the queue from the cells that were skipped</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={wrap(() => restartKernel())}
            >
              <RotateCcw className="size-4" />
              Restart kernel
            </Button>
          }
        />
        <TooltipContent>Reset execution counter and clear shared scope</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              className={cn(
                'h-[34px] gap-1.5 px-[13px] text-sm font-semibold',
                isBusy && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
              )}
              aria-label={isBusy ? 'Stop' : 'Run all'}
              onClick={wrap(() => (isBusy ? stopAll() : runAll()))}
            >
              {isBusy ? <StopCircle className="size-4" /> : <PlayCircle className="size-4" />}
              {isBusy ? 'Stop' : 'Run All'}
            </Button>
          }
        />
        <TooltipContent>
          {isBusy
            ? 'Stop the running cell and drain the queue'
            : 'Run every code cell in order; render all text cells'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}, 'NotebookToolbar')
