import { useEffect } from 'react'
import { Code2, Plus, Type } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { NotebookCell } from './NotebookCell'
import { NotebookOutline } from './NotebookOutline'
import { NotebookToolbar } from './NotebookToolbar'
import type { Cell, CellViewMode } from '../domain/cell'
import { addCell, cellsAtom, deleteCell, moveCell, updateCellCode } from '../model/notebook'
import { runCell, stopCell } from '../model/runtime'
import { prewarmWorker } from '../runtime/workerHost'

interface NotebookRowProps {
  cell: Cell
  isFirst: boolean
  isLast: boolean
}

const NotebookRow = reatomComponent<NotebookRowProps>(({ cell, isFirst, isLast }) => {
  return (
    <div data-cell-id={cell.id}>
      <NotebookCell
        executionCount={cell.executionCount()}
        kind={cell.kind}
        code={cell.code()}
        output={cell.output()}
        status={cell.status()}
        viewMode={cell.viewMode()}
        isFirst={isFirst}
        isLast={isLast}
        onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
        onViewModeChange={wrap((mode: CellViewMode) => cell.viewMode.set(mode))}
        onRun={wrap(() => runCell(cell.id))}
        onStop={wrap(() => stopCell(cell.id))}
        onDelete={wrap(() => deleteCell(cell.id))}
        onMoveUp={wrap(() => moveCell(cell.id, -1))}
        onMoveDown={wrap(() => moveCell(cell.id, 1))}
      />
    </div>
  )
}, 'NotebookRow')

interface CellInserterProps {
  afterId?: string
  variant?: 'between' | 'end'
}

const CellInserter = reatomComponent<CellInserterProps>(({ afterId, variant = 'between' }) => {
  const onAddCode = wrap(() => {
    addCell(afterId, 'code')
  })
  const onAddText = wrap(() => {
    addCell(afterId, 'markdown')
  })

  if (variant === 'end') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="self-center text-muted-foreground">
              <Plus className="size-3.5" /> Add cell
            </Button>
          }
        />
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={onAddCode}>
            <Code2 className="size-4" /> Code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddText}>
            <Type className="size-4" /> Text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  return (
    <div className="group/inserter relative h-2 -my-3 flex items-center justify-center">
      <div className="absolute inset-x-0 h-px bg-transparent group-hover/inserter:bg-border transition-colors" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="relative z-10 h-6 px-2 text-xs opacity-0 group-hover/inserter:opacity-100 transition-opacity"
            >
              <Plus className="size-3" /> Add cell
            </Button>
          }
        />
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={onAddCode}>
            <Code2 className="size-4" /> Code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddText}>
            <Type className="size-4" /> Text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}, 'CellInserter')

export const NotebookView = reatomComponent(() => {
  const cells = cellsAtom()

  // Spin up the sandbox worker (chunk fetch + QuickJS init) as soon as the
  // notebook is on screen, so the user's first Run feels instant instead of
  // paying the cold-start cost.
  useEffect(() => {
    prewarmWorker()
  }, [])

  return (
    <div className="flex flex-1 min-h-0">
      <main className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <header className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">JS Notebook</h1>
              <p className="mt-1 text-sm text-muted-foreground">Local scratchpad · autosaved</p>
            </div>
            <NotebookToolbar />
          </header>

          <div className="flex flex-col gap-6">
            {cells.map((cell, idx) => (
              <div key={cell.id} className="flex flex-col gap-6">
                <NotebookRow cell={cell} isFirst={idx === 0} isLast={idx === cells.length - 1} />
                {idx < cells.length - 1 ? <CellInserter afterId={cell.id} /> : null}
              </div>
            ))}

            <CellInserter
              afterId={cells.length > 0 ? cells[cells.length - 1].id : undefined}
              variant="end"
            />
          </div>
        </div>
      </main>

      <NotebookOutline />
    </div>
  )
}, 'NotebookView')
