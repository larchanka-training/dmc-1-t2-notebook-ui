// Persistent JSON shape of a notebook and the boundary validator for it.
//
// This is the on-disk contract (IndexedDB today, server sync later). It is
// deliberately aligned with the backend contract — `api/docs/openapi.json`
// (`CellSchema` / `NotebookResponse`) and `api/docs/auth.md` §7.2 — so the
// future sync layer maps 1:1 with no field renames or format migration:
//   - cell source field is `content` (the in-memory domain atom stays `code`;
//     the mapping lives only in the serializer)
//   - timestamps are Unix epoch milliseconds (`number`), not ISO strings
//   - `formatVersion` (not `schemaVersion`)
//
// Outputs and executionCount are intentionally NOT persisted: they are
// ephemeral run products, reproducible by re-running, and the backend does
// not store them either.
//
// Anything read back from storage (or imported) is untrusted input and MUST
// pass `assertNotebookJSON` before use (AGENTS.md §11).

import type { CellKind } from '../domain/cell'

/** Current persistent format version. Bumped only by a breaking format change. */
export const FORMAT_VERSION = 1

/** A single notebook cell as stored on disk. */
export interface CellJSON {
  /** Stable client-generated UUID. Survives reorder; basis for LWW identity. */
  id: string
  kind: CellKind
  /** Source text. JavaScript for `code`, GFM for `markdown`. */
  content: string
  /** Last content-modification time, Unix epoch ms. */
  updatedAt: number
}

/** A notebook document as stored on disk. */
export interface NotebookJSON {
  formatVersion: number
  id: string
  title: string
  /** Creation time, Unix epoch ms. */
  createdAt: number
  /** Last modification time, Unix epoch ms. */
  updatedAt: number
  cells: CellJSON[]
}

const CELL_KINDS: readonly CellKind[] = ['code', 'markdown']

// Cell/notebook ids are RFC 4122 UUIDs (backend `CellSchema.id` is
// `format: uuid`). Validate the shape at the boundary so a non-UUID id — e.g.
// from a broken client-side fallback — is rejected before it can reach sync.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function isCellJSON(value: unknown): value is CellJSON {
  if (!isObject(value)) return false
  return (
    isUuid(value['id']) &&
    typeof value['content'] === 'string' &&
    typeof value['updatedAt'] === 'number' &&
    Number.isFinite(value['updatedAt']) &&
    typeof value['kind'] === 'string' &&
    CELL_KINDS.includes(value['kind'] as CellKind)
  )
}

/**
 * Structural type guard for a fully-formed `NotebookJSON` at the current
 * format version. Does not migrate — callers that may receive an older
 * version run `applyMigrations` first (see `migrations.ts`).
 */
export function isNotebookJSON(value: unknown): value is NotebookJSON {
  if (!isObject(value)) return false
  return (
    value['formatVersion'] === FORMAT_VERSION &&
    isUuid(value['id']) &&
    typeof value['title'] === 'string' &&
    typeof value['createdAt'] === 'number' &&
    Number.isFinite(value['createdAt']) &&
    typeof value['updatedAt'] === 'number' &&
    Number.isFinite(value['updatedAt']) &&
    Array.isArray(value['cells']) &&
    value['cells'].every(isCellJSON)
  )
}

/** Throwing variant of {@link isNotebookJSON}, for use at storage/import boundaries. */
export function assertNotebookJSON(value: unknown): asserts value is NotebookJSON {
  if (!isNotebookJSON(value)) {
    throw new Error('Invalid notebook JSON: shape does not match the persistent schema')
  }
}
