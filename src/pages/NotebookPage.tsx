import { useRef, useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotebookCell, type CellStatus } from '@/components/common/NotebookCell'
import { executeJS } from '@/lib/executeJS'

interface Cell {
  id: string
  code: string
  output: string
  status: CellStatus
}

function uid() {
  return Math.random().toString(36).slice(2)
}

function makeCell(code = ''): Cell {
  return { id: uid(), code, output: '', status: 'idle' }
}

export default function NotebookPage() {
  const [cells, setCells] = useState<Cell[]>([
    makeCell('console.log("Hello from JS Notebook!")'),
  ])
  const cellRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const updateCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  const runCell = useCallback(async (id: string) => {
    const cell = cells.find(c => c.id === id)
    if (!cell) return
    updateCell(id, { status: 'running', output: '' })
    const { output, error } = await executeJS(cell.code)
    updateCell(id, { status: error ? 'error' : 'done', output })
  }, [cells, updateCell])

  const addCell = useCallback((afterId?: string) => {
    const cell = makeCell()
    setCells(prev => {
      if (!afterId) return [...prev, cell]
      const idx = prev.findIndex(c => c.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, cell)
      return next
    })
    setTimeout(() => cellRefs.current[cell.id]?.focus(), 50)
  }, [])

  const deleteCell = useCallback((id: string) => {
    setCells(prev => prev.length === 1 ? prev : prev.filter(c => c.id !== id))
  }, [])

  const moveCell = useCallback((id: string, dir: -1 | 1) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id)
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }, [])

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
