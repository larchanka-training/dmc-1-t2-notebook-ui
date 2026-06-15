import { atom } from '@reatom/core'

// Two ways to assemble the AI generation context, switchable by env flag:
//
// * 'at-send'   — (default) build the context from all cells at the moment the
//                 user clicks generate. Nothing is persisted.
// * 'persisted' — build asynchronously and persist it server-side; on entry the
//                 last saved context is loaded, edits trigger async rebuilds in
//                 user-operation order, deletes clear + rebuild, and the send
//                 path waits for the in-flight build to settle.
//
// VITE_AI_CONTEXT_MODE selects the mode at build time; the atom lets tests flip
// it without rebuilding.
export type AiContextMode = 'at-send' | 'persisted'

function readModeFromEnv(): AiContextMode {
  return import.meta.env.VITE_AI_CONTEXT_MODE === 'persisted' ? 'persisted' : 'at-send'
}

export const aiContextModeAtom = atom<AiContextMode>(readModeFromEnv(), 'notebook.aiContextMode')
