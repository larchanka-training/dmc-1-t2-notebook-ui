import { Plus } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import { NotebookCell } from './NotebookCell'
import type { Cell } from '../domain/cell'
import {
  addCell,
  cellsAtom,
  deleteCell,
  moveCell,
  runCell,
  updateCellCode,
} from '../model/notebook'

interface NotebookRowProps {
  cell: Cell
  index: number
  isFirst: boolean
  isLast: boolean
}

const NotebookRow = reatomComponent<NotebookRowProps>(
  ({ cell, index, isFirst, isLast }) => {
    return (
      <NotebookCell
        index={index}
        code={cell.code()}
        output={cell.output()}
        status={cell.status()}
        isFirst={isFirst}
        isLast={isLast}
        onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
        onRun={wrap(() => runCell(cell.id))}
        onDelete={wrap(() => deleteCell(cell.id))}
        onMoveUp={wrap(() => moveCell(cell.id, -1))}
        onMoveDown={wrap(() => moveCell(cell.id, 1))}
      />
    )
  },
  'NotebookRow',
)

export const NotebookView = reatomComponent(() => {
  const cells = cellsAtom()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-sidebar">
        <span className="text-sm font-medium text-muted-foreground mr-2">JS Notebook</span>
        <Button size="sm" variant="outline" onClick={wrap(() => addCell())}>
          <Plus className="size-3.5" /> Add Cell
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4 overflow-auto flex-1">
        {cells.map((cell, idx) => (
          <NotebookRow
            key={cell.id}
            cell={cell}
            index={idx + 1}
            isFirst={idx === 0}
            isLast={idx === cells.length - 1}
          />
        ))}

        <Button variant="ghost" className="self-start text-muted-foreground" onClick={wrap(() => addCell())}>
          <Plus className="size-3.5" /> Add cell
        </Button>
      </div>
    </div>
  )
}, 'NotebookView')
