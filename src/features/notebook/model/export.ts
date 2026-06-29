// User-triggered notebook export. Reads the current in-memory state,
// serializes it to the requested format, and hands a Blob to `downloadBlob`
// for the browser-native save dialog. The whole flow is read-only — no atom
// writes, no autosave bump, no remote sync.
//
// Format choice is the caller's: 'json' yields a re-importable snapshot;
// 'markdown' is a human-readable rendering. Both are produced offline from
// local state — there is no API call, so the export works even when the user
// is signed out or offline.
//
// Why not reuse `notebookSnapshot()` from the model: that helper stamps
// `updatedAt: Date.now()` because autosave's `snapshotAfter` requires the
// value to be strictly greater than the last persisted base. For *export*
// that would silently rewrite the document's last-modified timestamp on
// every click — non-deterministic and misleading on re-import (the autosave
// version-compare would see a falsely-newer document). Instead we synthesize
// the snapshot here with a deterministic `updatedAt`: the max of (a) the
// latest cell edit time, (b) the last persisted base, (c) the create time.

import { action } from '@reatom/core'
import { toJSON, toMarkdown } from '../persistence/serialize'
import type { Cell } from '../domain/cell'
import type { NotebookJSON } from '../persistence/schema'
import {
  activeNotebookIdAtom,
  cellsAtom,
  notebookBaseUpdatedAtAtom,
  notebookCreatedAtAtom,
  notebookTitleAtom,
} from './notebook'
import { downloadBlob } from '@/shared/lib/downloadBlob'
import { sanitizeFilename } from '@/shared/lib/sanitizeFilename'

export type ExportFormat = 'json' | 'markdown'

interface FormatSpec {
  body: string
  mime: string
  ext: string
}

function exportUpdatedAt(cells: Cell[]): number {
  let max = notebookCreatedAtAtom()
  const base = notebookBaseUpdatedAtAtom()
  if (base !== null && base > max) max = base
  for (const cell of cells) {
    const at = cell.updatedAt()
    if (at > max) max = at
  }
  return max
}

function exportSnapshot(): NotebookJSON {
  const cells = cellsAtom()
  return toJSON(cells, {
    id: activeNotebookIdAtom(),
    title: notebookTitleAtom(),
    createdAt: notebookCreatedAtAtom(),
    updatedAt: exportUpdatedAt(cells),
  })
}

function buildExport(format: ExportFormat): FormatSpec {
  const snapshot = exportSnapshot()
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
