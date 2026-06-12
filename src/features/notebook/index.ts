export { NotebookView } from './ui/NotebookView'
export { NotebookCell } from './ui/NotebookCell'
export { NotebookToolbar } from './ui/NotebookToolbar'
export { SaveIndicator } from './ui/SaveIndicator'
export { ShortcutsHelp, shortcutsOpenAtom } from './ui/ShortcutsHelp'
export { RenameNotebookDialog } from './ui/RenameNotebookDialog'
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
  SEED_CODE,
} from './model/notebook'
export {
  startAutosave,
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
} from './model/notebookSettings'
export type { RenameTarget } from './model/notebookSettings'
export { notebookListResource, createNotebookAction } from './model/notebookList'
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
