import { useCallback, useRef, useState } from 'react'
import { type Cell, makeCell } from '../domain/cell'
import { executeJS } from './executeJS'

export function useNotebook(initialCode = '') {
  const [cells, setCells] = useState<Cell[]>([makeCell(initialCode)])
  const cellRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const updateCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const runCell = useCallback(
    async (id: string) => {
      const cell = cells.find(c => c.id === id)
      if (!cell) return
      updateCell(id, { status: 'running', output: '' })
      const { output, error } = await executeJS(cell.code)
      updateCell(id, { status: error ? 'error' : 'done', output })
    },
    [cells, updateCell],
  )

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
    setCells(prev => (prev.length === 1 ? prev : prev.filter(c => c.id !== id)))
  }, [])

  const moveCell = useCallback((id: string, dir: -1 | 1) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id)
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }, [])

  return { cells, updateCell, runCell, addCell, deleteCell, moveCell }
}
