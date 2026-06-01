import { action, atom } from '@reatom/core'

// Jupyter-style modal editing. A cell is either being *edited* (focus is in
// the code/markdown editor, keystrokes type text) or in *command* mode (focus
// is on the cell shell, keystrokes are shortcuts like A/B/D D/M/Y). Only one
// cell is "active" at a time; `null` means no cell holds focus.
//
// This module owns only the mode state. The hotkey wiring that reads it lives
// in the UI layer (S4) and must go through `wrap(...)` at the React boundary,
// per the strict async-stack rule (`src/setup.ts` → `clearStack()`).

export type CellMode = 'edit' | 'command'

/** Id of the cell that currently holds focus, or `null` when none does. */
export const activeCellIdAtom = atom<string | null>(null, 'notebook.cellMode.activeId')

/** Modal state of the active cell. Meaningless while `activeCellIdAtom` is null. */
export const cellModeAtom = atom<CellMode>('command', 'notebook.cellMode.mode')

/** Focus a cell in command mode (e.g. on click of the cell shell or arrow nav). */
export const focusCell = action((id: string | null) => {
  activeCellIdAtom.set(id)
  cellModeAtom.set('command')
}, 'notebook.cellMode.focusCell')

/** Enter edit mode for a cell (Enter in command mode, or click into the editor). */
export const enterEdit = action((id: string) => {
  activeCellIdAtom.set(id)
  cellModeAtom.set('edit')
}, 'notebook.cellMode.enterEdit')

/** Leave edit mode back to command mode, keeping the same cell active (Esc). */
export const enterCommand = action(() => {
  cellModeAtom.set('command')
}, 'notebook.cellMode.enterCommand')
