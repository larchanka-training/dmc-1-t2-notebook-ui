export { NotebookView } from './ui/NotebookView'
export { NotebookCell } from './ui/NotebookCell'
export { NotebookToolbar } from './ui/NotebookToolbar'
export { SaveIndicator } from './ui/SaveIndicator'
export { SyncIndicator } from './ui/SyncIndicator'
export { ShortcutsHelp, shortcutsOpenAtom } from './ui/ShortcutsHelp'
export { RenameNotebookDialog } from './ui/RenameNotebookDialog'
export { DeleteNotebookDialog } from './ui/DeleteNotebookDialog'
export {
  cellsAtom,
  addCell,
  addCellAt,
  deleteCell,
  moveCell,
  moveCellTo,
  changeCellKind,
  updateCellCode,
  setNotebookTitle,
  notebookTitleAtom,
  loadNotebook,
  notebookLoadedAtom,
  notebookBaseUpdatedAtAtom,
  storageCompatibilityAtom,
  restoreNotebook,
  LOCAL_NOTEBOOK_ID,
  activeNotebookIdAtom,
  SEED_CODE,
} from './model/notebook'
export {
  startAutosave,
  drainAutosave,
  markBootRestored,
  saveStatusAtom,
  lastSavedAtAtom,
  hasLocalChangesAtom,
  reloadFromStorage,
  saveMine,
  saveNow,
} from './model/autosave'
export type { SaveStatus } from './model/autosave'
export {
  startRemoteSync,
  pauseRemoteSync,
  remoteSyncStatusAtom,
  pausedAtom,
} from './model/remoteSync'
export type { RemoteSyncStatus } from './model/remoteSync'
export {
  runCell,
  runAll,
  resumeQueue,
  stopCell,
  stopAll,
  restartKernel,
  runtimeStatusAtom,
  execCounterAtom,
  queueAtom,
  skippedCellsAtom,
} from './model/runtime'
export {
  activeCellIdAtom,
  cellModeAtom,
  focusCell,
  enterEdit,
  enterCommand,
} from './model/cellMode'
export type { CellMode } from './model/cellMode'
export {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  timeoutMsAtom,
  lineNumbersAtom,
  outlineVisibleAtom,
  outlineDrawerOpenAtom,
  renameTargetAtom,
  deleteTargetAtom,
} from './model/notebookSettings'
export type { RenameTarget, DeleteTarget } from './model/notebookSettings'
export {
  notebookListResource,
  createNotebookAction,
  deleteNotebookAction,
  startNotebookListSync,
} from './model/notebookList'
export { openNotebookInSlot, startSlot, stopSlot } from './model/slot'
export { undo, redo, clearHistory, canUndoAtom, canRedoAtom } from './model/history'
export {
  searchOpenAtom,
  searchQueryAtom,
  useRegexAtom,
  caseSensitiveAtom,
  searchMatchesAtom,
  matchCountLabelAtom,
  activeMatchIndexAtom,
  activeMatchAtom,
  openSearch,
  closeSearch,
  setSearchQuery,
  nextMatch,
  prevMatch,
} from './model/search'
export type { SearchMatch } from './model/search'
export { reatomCell } from './domain/cell'
export type { Cell, CellKind, CellStatus, CellViewMode } from './domain/cell'
export { runInWorker, restartWorker } from './runtime/workerHost'
export type { OutputItem, RuntimeStatus, SerializedValue } from './runtime/types'
export { codeGeneratorAtom, loadedModelAtom } from './model/codeGenerator'
export { aiContextModeAtom } from './model/context-ai/aiContextMode'
export type { AiContextMode } from './model/context-ai/aiContextMode'
export {
  startAiContextSync,
  persistedContextAtom,
  whenContextReady,
} from './model/context-ai/aiContext'
export {
  buildNotebookContext,
  contextToPromptBlock,
  CONTEXT_BYTE_CAP,
  DEFAULT_CONTEXT_WINDOW,
} from './model/context-ai/contextBuilder'
