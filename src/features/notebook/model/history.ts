import { action, atom, computed } from '@reatom/core'
import { bumpNotebookRevision } from './revision'

// Notebook-level undo/redo. The stack holds the last 50 user operations over
// the cell list — add, delete, move, change-kind, edit-source. Output and
// executionCount changes are deliberately NOT recorded (running a cell is not
// an "edit" you undo). The stack itself is in-memory: it is reset on boot-load
// (`clearHistory` in notebook.ts). Cell content is persisted separately (in
// IndexedDB), but the undo history is not — a reloaded notebook starts with an
// empty stack.
//
// An Operation is a pair of thunks that drive the model directly (not through
// the recording actions), so applying undo/redo never re-enters the history.

export interface Operation {
  undo: () => void
  redo: () => void
  // Operations sharing a coalesceKey within COALESCE_MS merge into one entry,
  // so a burst of keystrokes in one cell is a single undo step.
  coalesceKey?: string
}

interface Entry {
  op: Operation
  at: number
}

const MAX_HISTORY = 50
const COALESCE_MS = 1000

const pastAtom = atom<Entry[]>([], 'notebook.history.past')
const futureAtom = atom<Operation[]>([], 'notebook.history.future')

export const canUndoAtom = computed(() => pastAtom().length > 0, 'notebook.history.canUndo')
export const canRedoAtom = computed(() => futureAtom().length > 0, 'notebook.history.canRedo')

/** Record a freshly-applied operation. Clears the redo branch. */
export const recordOperation = action((op: Operation, now: number = Date.now()) => {
  const past = pastAtom()
  const last = past[past.length - 1]
  if (op.coalesceKey && last?.op.coalesceKey === op.coalesceKey && now - last.at <= COALESCE_MS) {
    // Merge: keep the ORIGINAL undo (start of the burst), adopt the new redo.
    const merged: Entry = {
      op: { undo: last.op.undo, redo: op.redo, coalesceKey: op.coalesceKey },
      at: now,
    }
    pastAtom.set([...past.slice(0, -1), merged])
  } else {
    pastAtom.set([...past, { op, at: now }].slice(-MAX_HISTORY))
  }
  futureAtom.set([])
}, 'notebook.history.record')

export const undo = action(() => {
  const past = pastAtom()
  const entry = past[past.length - 1]
  if (!entry) return
  entry.op.undo()
  bumpNotebookRevision()
  pastAtom.set(past.slice(0, -1))
  futureAtom.set([entry.op, ...futureAtom()])
}, 'notebook.history.undo')

export const redo = action(() => {
  const future = futureAtom()
  const op = future[0]
  if (!op) return
  op.redo()
  bumpNotebookRevision()
  futureAtom.set(future.slice(1))
  // Re-push without coalescing into the previous entry.
  pastAtom.set([...pastAtom(), { op, at: Date.now() }].slice(-MAX_HISTORY))
}, 'notebook.history.redo')

/** Drop all history. Call when switching notebooks. */
export const clearHistory = action(() => {
  pastAtom.set([])
  futureAtom.set([])
}, 'notebook.history.clear')
