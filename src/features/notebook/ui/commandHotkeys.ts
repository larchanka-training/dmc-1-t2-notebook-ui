import { wrap } from '@reatom/core'
import { useHotkeys } from '@/shared/lib/hotkeys'
import { addCell, addCellAt, cellsAtom, changeCellKind, deleteCell } from '../model/notebook'
import { activeCellIdAtom, cellModeAtom, enterEdit, focusCell } from '../model/cellMode'
import { isCellQueuedOrRunning } from '../model/runtime'

// Change the active cell's kind, unless it is part of the current run. A cell
// that is executing or still queued for Run All must not be converted: the
// queue holds ids and would otherwise reach `executeCell` with a now-markdown
// cell. (Running cells are also guarded inside `changeCellKind` itself; this
// blocks the queued case too, which the model can't see.)
function changeKind(kind: 'code' | 'markdown'): void {
  const id = activeCellIdAtom()
  if (!id || isCellQueuedOrRunning(id)) return
  changeCellKind(id, kind)
}

// Time window for the Jupyter "D D" delete gesture: two quick D presses.
const DOUBLE_KEY_MS = 600

// The cell + timestamp of the last lone "D". Module-level because command mode
// is a single global interaction (one focused cell at a time), and keeping it
// out of the render body avoids reading a ref during render. Tracking the cell
// (not just the time) means the two D presses must land on the SAME cell:
// D on A, arrow to B, D on B within the window must NOT delete B.
let lastD: { id: string; at: number } | null = null

// The "D D" delete gesture lives in a plain module function (not inside the
// hook body) so its impure timer/state access is outside React's render path.
function handleDeleteGesture(): void {
  const now = Date.now()
  const id = activeCellIdAtom()
  // First D, or the confirming D landed on a different cell / too late: (re)arm
  // the gesture on the current cell and wait for the second press.
  if (!lastD || lastD.id !== id || now - lastD.at > DOUBLE_KEY_MS) {
    lastD = id ? { id, at: now } : null
    return
  }
  lastD = null
  if (!id) return
  const fallback = neighbourId(id, 1) ?? neighbourId(id, -1)
  const before = cellsAtom().length
  deleteCell(id)
  // deleteCell is a no-op when this is the last remaining cell (the model
  // protects it). Only move focus when a cell was actually removed — otherwise
  // focusCell(null) would clear activeCellId and silently disable every
  // command-mode shortcut until the next mouse click.
  if (cellsAtom().length < before) focusCell(fallback)
}

function neighbourId(id: string, dir: -1 | 1): string | null {
  const cells = cellsAtom()
  const idx = cells.findIndex((c) => c.id === id)
  if (idx === -1) return null
  return cells[idx + dir]?.id ?? null
}

/**
 * Command-mode keyboard shortcuts (Jupyter-style), active only when a cell is
 * focused and not being edited. Bindings:
 *   A / B  insert code cell above / below
 *   D D    delete the active cell (two quick presses)
 *   M / Y  change kind to markdown / code
 *   ↑ / ↓  move focus to the previous / next cell
 *   Enter  enter edit mode
 * Handlers are wrapped for the strict async stack (`src/setup.ts`).
 */
export function useCommandModeHotkeys(): void {
  const active = activeCellIdAtom()
  const enabled = active != null && cellModeAtom() === 'command'

  useHotkeys(
    {
      a: wrap(() => {
        const id = activeCellIdAtom()
        if (!id) return
        const idx = cellsAtom().findIndex((c) => c.id === id)
        if (idx === -1) return
        // Insert directly at the active cell's index so it lands above it.
        // One model action = one undo step (a compound add+move would be two).
        const inserted = addCellAt(idx, 'code')
        focusCell(inserted.id)
      }),
      b: wrap(() => {
        const id = activeCellIdAtom()
        if (!id) return
        const inserted = addCell(id, 'code')
        focusCell(inserted.id)
      }),
      d: wrap(handleDeleteGesture),
      m: wrap(() => changeKind('markdown')),
      y: wrap(() => changeKind('code')),
      ArrowUp: wrap(() => {
        const id = activeCellIdAtom()
        if (!id) return
        const prev = neighbourId(id, -1)
        if (prev) focusCell(prev)
      }),
      ArrowDown: wrap(() => {
        const id = activeCellIdAtom()
        if (!id) return
        const next = neighbourId(id, 1)
        if (next) focusCell(next)
      }),
      Enter: wrap(() => {
        const id = activeCellIdAtom()
        if (id) enterEdit(id)
      }),
    },
    enabled,
  )
}
