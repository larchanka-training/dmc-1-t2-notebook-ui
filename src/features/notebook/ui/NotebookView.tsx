import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { NotebookCell } from './NotebookCell'
import { useNotebook } from '../model/useNotebook'

export function NotebookView() {
  const { cells, updateCell, runCell, addCell, deleteCell, moveCell } = useNotebook(
    'console.log("Hello from JS Notebook!")',
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-sidebar">
        <span className="text-sm font-medium text-muted-foreground mr-2">JS Notebook</span>
        <Button size="sm" variant="outline" onClick={() => addCell()}>
          <Plus className="size-3.5" /> Add Cell
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4 overflow-auto flex-1">
        {cells.map((cell, idx) => (
          <NotebookCell
            key={cell.id}
            index={idx + 1}
            code={cell.code}
            output={cell.output}
            status={cell.status}
            isFirst={idx === 0}
            isLast={idx === cells.length - 1}
            onCodeChange={code => updateCell(cell.id, { code })}
            onRun={() => runCell(cell.id)}
            onDelete={() => deleteCell(cell.id)}
            onMoveUp={() => moveCell(cell.id, -1)}
            onMoveDown={() => moveCell(cell.id, 1)}
          />
        ))}

        <Button variant="ghost" className="self-start text-muted-foreground" onClick={() => addCell()}>
          <Plus className="size-3.5" /> Add cell
        </Button>
      </div>
    </div>
  )
}
