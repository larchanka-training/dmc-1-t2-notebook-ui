import { Hash, PlayCircle, RotateCcw, SkipForward, StopCircle } from 'lucide-react'
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
 * Notebook-wide control bar: Run All, Stop All, Restart Kernel.
 * Mounted in the header above the cell list.
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
              <Hash className="size-4" />
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
              variant="outline"
              className="gap-1.5"
              disabled={!isBusy}
              onClick={wrap(() => stopAll())}
            >
              <StopCircle className="size-4" />
              Stop All
            </Button>
          }
        />
        <TooltipContent>Stop the running cell and drain the queue</TooltipContent>
      </Tooltip>

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
            <Button size="sm" className="gap-1.5" disabled={isBusy} onClick={wrap(() => runAll())}>
              <PlayCircle className="size-4" />
              Run All
            </Button>
          }
        />
        <TooltipContent>Run every code cell in order; render all text cells</TooltipContent>
      </Tooltip>
    </div>
  )
}, 'NotebookToolbar')
