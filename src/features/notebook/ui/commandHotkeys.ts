import { wrap } from '@reatom/core'
import { useHotkeys } from '@/shared/lib/hotkeys'
import { addCell, addCellAt, cellsAtom, changeCellKind, deleteCell } from '../model/notebook'
import { activeCellIdAtom, cellModeAtom, enterEdit, focusCell } from '../model/cellMode'

// Time window for the Jupyter "D D" delete gesture: two quick D presses.
const DOUBLE_KEY_MS = 600

// Timestamp of the last lone "D". Module-level because command mode is a
// single global interaction (one focused cell at a time), and keeping it out
// of the render body avoids reading a ref during render.
let lastDPress = 0

// The "D D" delete gesture lives in a plain module function (not inside the
// hook body) so its impure timer/state access is outside React's render path.
function handleDeleteGesture(): void {
  const now = Date.now()
  if (now - lastDPress <= DOUBLE_KEY_MS) {
    lastDPress = 0
    const id = activeCellIdAtom()
    if (!id) return
    const fallback = neighbourId(id, 1) ?? neighbourId(id, -1)
    deleteCell(id)
    focusCell(fallback)
  } else {
    lastDPress = now
  }
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
      m: wrap(() => {
        const id = activeCellIdAtom()
        if (id) changeCellKind(id, 'markdown')
      }),
      y: wrap(() => {
        const id = activeCellIdAtom()
        if (id) changeCellKind(id, 'code')
      }),
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
