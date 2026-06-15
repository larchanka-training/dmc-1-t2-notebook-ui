// User-tunable notebook-wide settings. Currently holds the execution
// timeout, but the file exists so future settings (output budget, max
// scope size, etc.) have an obvious home.
//
// Persistence: in-memory for now; sessionStorage / per-notebook persistence
// can hook in here without touching call sites.
//
// The numeric bounds live in the neutral `runtime/limits` module (shared
// with the worker/kernel, which must not import this Reatom-flavored file).

import { atom, withLocalStorage } from '@reatom/core'
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from '../runtime/limits'

export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS }

/**
 * Per-cell execution timeout. Consumed by `executeCell` in `runtime.ts`
 * (clamped to `[MIN, MAX]` at read time); set by the (future) Settings UI.
 */
export const timeoutMsAtom = atom<number>(DEFAULT_TIMEOUT_MS, 'notebook.settings.timeoutMs')

/**
 * Whether code cells show line numbers in the CodeMirror gutter. Off by
 * default to keep short scratch cells compact; toggled from the toolbar.
 * Persisted so the choice survives reloads (read reactively from components,
 * so plain withLocalStorage works — same pattern as themeModeAtom).
 */
export const lineNumbersAtom = atom<boolean>(false, 'notebook.settings.lineNumbers').extend(
  withLocalStorage('notebook.settings.lineNumbers'),
)

/**
 * Whether the notebook outline pane is visible on wide (>1280px) layouts,
 * where it is an inline sticky column. Toggled from the global topbar's
 * outline button (`aria-pressed` mirrors this). On by default; the outline
 * still self-hides when there are no headings to navigate.
 */
export const outlineVisibleAtom = atom<boolean>(true, 'notebook.settings.outlineVisible').extend(
  withLocalStorage('notebook.settings.outlineVisible'),
)

/**
 * Whether the outline floating drawer is open on narrow (≤1280px) layouts.
 * Separate from `outlineVisibleAtom`: the wide column is "shown by default,
 * hideable", while the narrow drawer is "closed by default, openable". The same
 * topbar button drives whichever one applies at the current width.
 */
export const outlineDrawerOpenAtom = atom<boolean>(false, 'notebook.settings.outlineDrawerOpen')

/**
 * The notebook targeted by the sidebar "Rename" action, or null when the rename
 * dialog is closed. Decoupled from the open editor so any listed notebook can
 * be renamed, not just the current one (new-design-v2 renames from a modal).
 * `id === LOCAL_NOTEBOOK_ID` means the open local notebook (rename persists via
 * setNotebookTitle); other ids are backend rows whose rename is presentational
 * until the notebook-management epic adds a PATCH endpoint.
 */
export interface RenameTarget {
  id: string
  title: string
}
export const renameTargetAtom = atom<RenameTarget | null>(null, 'notebook.settings.renameTarget')

/**
 * The notebook targeted by the sidebar "Delete" action, or null when the confirm
 * dialog is closed (#135). Only backend-identity notebooks (rows in the list /
 * synced) are deletable; the local-only welcome-seed floor is regenerated on boot
 * and has no Delete affordance, so this never carries `LOCAL_NOTEBOOK_ID`.
 */
export interface DeleteTarget {
  id: string
  title: string
}
export const deleteTargetAtom = atom<DeleteTarget | null>(null, 'notebook.settings.deleteTarget')
