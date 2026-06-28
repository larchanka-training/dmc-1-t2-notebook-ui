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
  bootSeedSuppressedAtom,
  notebookBaseUpdatedAtAtom,
  storageCompatibilityAtom,
  restoreNotebook,
  LOCAL_NOTEBOOK_ID,
  LEGACY_LOCAL_NOTEBOOK_ID,
  DEMO_NAMESPACE,
  DEMO_NOTEBOOK_ID,
  resolveDemoNotebookId,
  activeNotebookIdAtom,
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
  createNotebookFlow,
  promoteSeedFloorIfUnsynced,
  deleteNotebookAction,
  startNotebookListSync,
  upsertListItem,
  canDeleteNotebooks,
  canCreateNotebook,
  MAX_NOTEBOOKS,
} from './model/notebookList'
export { reconcileBootFromServer } from './model/bootReconcile'
export { clearSeedTombstone, isSeedTombstoned, setSeedTombstone } from './model/seedTombstone'
export {
  openNotebookInSlot,
  resetSlotToFloorForAccountChange,
  startSlot,
  stopSlot,
  slotOpenErrorAtom,
  slotOpeningPhaseAtom,
} from './model/slot'
export type { OpenOutcome, SlotOpeningPhase } from './model/slot'
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
export {
  codeGeneratorAtom,
  interruptInBrowserAtom,
  loadedModelDisplayAtom,
  inBrowserGeneratingCellIdAtom,
  inBrowserGenerateErrorsAtom,
  IN_BROWSER_MAX_TOKENS,
  IN_BROWSER_THINK_TOKEN_BUDGET,
} from './model/codeGenerator'
export type {
  InBrowserGenerator,
  InBrowserGenerateResult,
  InBrowserIncompleteReason,
  InBrowserProgress,
} from './model/codeGenerator'
export { cloudGenerateAndInsertCodeAction } from './model/cloudCodeGenerator'
export {
  thinkingSessionAtom,
  startThinkingAction,
  updateThinkingAction,
  finishThinkingAction,
  failThinkingAction,
  dismissThinkingAction,
  requestStopAction,
} from './model/inBrowserThinking'
export type { ThinkingSession, ThinkingPhase } from './model/inBrowserThinking'
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
