// User-triggered notebook export. Reads the current in-memory snapshot via
// `notebookSnapshot()`, serializes it to the requested format, and hands a
// Blob to `downloadBlob` for the browser-native save dialog. The whole flow
// is read-only — no atom writes, no autosave bump, no remote sync.
//
// Format choice is the caller's: 'json' yields the full persisted snapshot
// (suitable for re-import in the future); 'markdown' is a human-readable
// rendering. Both are produced offline from local state — there is no API
// call, so the export works even when the user is signed out or offline.

import { action } from '@reatom/core'
import { toMarkdown } from '../persistence/serialize'
import { notebookSnapshot, activeNotebookIdAtom, notebookTitleAtom } from './notebook'
import { downloadBlob } from '@/shared/lib/downloadBlob'
import { sanitizeFilename } from '@/shared/lib/sanitizeFilename'

export type ExportFormat = 'json' | 'markdown'

interface FormatSpec {
  body: string
  mime: string
  ext: string
}

function buildExport(format: ExportFormat): FormatSpec {
  const snapshot = notebookSnapshot()
  if (format === 'json') {
    return {
      body: JSON.stringify(snapshot, null, 2),
      mime: 'application/json',
      ext: 'json',
    }
  }
  return {
    body: toMarkdown(snapshot),
    mime: 'text/markdown',
    ext: 'md',
  }
}

export const exportNotebook = action((format: ExportFormat) => {
  const { body, mime, ext } = buildExport(format)
  const blob = new Blob([body], { type: `${mime};charset=utf-8` })
  const name = `${sanitizeFilename(notebookTitleAtom(), activeNotebookIdAtom())}.${ext}`
  downloadBlob(blob, name)
}, 'notebook.export')
