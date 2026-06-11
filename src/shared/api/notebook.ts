import { notebookClient } from './client'
import { NetworkError, toApiError } from './errors'
import type { components } from './generated/openapi-ts/notebook'

// Typed facade over the generated notebook client. Business code (features /
// pages / app) talks to the backend only through these functions and the
// domain types below — never through the generated `paths`/`components`.
type Schemas = components['schemas']

/** A notebook with its cells, as returned by GET/POST/PATCH. */
export type Notebook = Schemas['NotebookResponse']
/** A lightweight row from GET /notebooks (no cells, just `cellsCount`). */
export type NotebookListItem = Schemas['NotebookListItem']
/** A single notebook cell on the wire. */
export type NotebookCell = Schemas['CellSchema']

/**
 * What the caller provides to create a notebook. `formatVersion` is owned by
 * the domain model (features/notebook/persistence), not the transport layer,
 * so it is passed in rather than hardcoded here. `id` lets the client choose
 * the identifier for offline-first idempotency (re-POSTing the same id does
 * not duplicate).
 */
export interface CreateNotebookInput {
  title: string
  formatVersion: number
  id?: string
  cells?: NotebookCell[]
}

// GET /notebooks is paginated ({ items, total, limit, offset }); the facade
// currently reads a single page at the server max so users with many notebooks
// are not silently truncated. TODO(#135): real pagination / bootstrap.
const LIST_PAGE_LIMIT = 200

/**
 * Unwrap an openapi-fetch result into the success payload or throw a typed
 * ApiError. `fetch` rejects (TypeError) only when no HTTP response arrives —
 * offline, DNS failure, connection reset — which we surface as NetworkError so
 * the sync layer can tell "retry later" apart from an auth/validation status.
 */
async function request<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await call
  } catch (cause) {
    throw new NetworkError('Notebook request failed', cause)
  }
  const { data, error, response } = result
  if (error !== undefined || data === undefined) throw toApiError(response.status, error)
  return data
}

export async function list(): Promise<NotebookListItem[]> {
  const data = await request<Schemas['NotebookListResponse']>(
    notebookClient.GET('/notebooks', { params: { query: { limit: LIST_PAGE_LIMIT } } }),
  )
  return data.items
}

export async function create(input: CreateNotebookInput): Promise<Notebook> {
  const body: Schemas['NotebookCreate'] = {
    title: input.title,
    formatVersion: input.formatVersion,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.cells !== undefined ? { cells: input.cells } : {}),
  }
  return await request<Notebook>(notebookClient.POST('/notebooks', { body }))
}
