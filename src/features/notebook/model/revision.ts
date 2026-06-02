import { action, atom } from '@reatom/core'

// Monotonic local revision of the notebook's persisted content. Unlike
// `cellsAtom`, this changes on inner-cell edits too, so autosave can track
// dirty state in O(1) without re-serializing the whole notebook on every key.
//
// Bump it exactly when the persisted notebook shape changes:
// - cell source edit
// - structural cell operation (add/delete/reorder/change kind)
// - notebook title change (`setNotebookTitle`)
// - undo / redo of any persisted edit
// - restoring a notebook from storage (boot load / seamless cross-tab pull)
//
// Outputs, run status and execution count are NOT persisted, so they must not
// touch this revision.
export const notebookRevisionAtom = atom(0, 'notebook.revision')

/** Mark one persisted notebook-content change. */
export const bumpNotebookRevision = action(() => {
  notebookRevisionAtom.set((revision) => revision + 1)
}, 'notebook.revision.bump')
