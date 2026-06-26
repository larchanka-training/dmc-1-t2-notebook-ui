import { notebookClient } from './client'
import { ApiError, NetworkError, parseRetryAfter, toApiError } from './errors'
import type { components } from './generated/openapi-ts/notebook'

// Typed facade over the generated notebook client. Business code (features /
// pages / app) talks to the backend only through these functions and the
// domain types below — never through the generated `paths`/`components`.
type Schemas = components['schemas']

/** A single notebook cell on the wire. */
export type NotebookCell = Schemas['CellSchema']
/**
 * A notebook with its cells, as returned by GET/POST/PATCH. `cells` is
 * optional on the wire (`NotebookResponse` does not require it), but the facade
 * normalizes it to an array at the boundary, so consumers can always treat
 * `cells` as a present array — even when the server omits the field.
 */
export type Notebook = Omit<Schemas['NotebookResponse'], 'cells'> & { cells: NotebookCell[] }
/** A lightweight row from GET /notebooks (no cells, just `cellsCount`). */
export type NotebookListItem = Schemas['NotebookListItem']
/** A deleted-cell marker. Request-only: it appears in PATCH bodies, never in responses. */
export type CellTombstone = Schemas['CellTombstone']

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

/**
 * What the caller provides to update a notebook. PATCH sends the whole
 * notebook (LWW merge happens server-side), so `cells` is the full set, not a
 * delta. `deletedCells` carries tombstones so cell removals propagate too; it
 * is request-only and absent from the response.
 */
export interface UpdateNotebookInput {
  title: string
  formatVersion: number
  cells: NotebookCell[]
  deletedCells?: CellTombstone[]
}

// GET /notebooks is paginated ({ items, total, limit, offset }); the facade
// reads a single page at the server maximum of 200. With more than 200
// notebooks the tail is not returned; list() logs a warning when it detects
// this truncation. TODO(#135): real pagination / bootstrap.
//
// Exported because it is also the EFFECTIVE notebook cap the UI enforces: the
// client only ever loads/syncs this first page, so a notebook beyond it would be
// invisible and unsynced. The create affordance and the model-level create guard
// (`MAX_NOTEBOOKS` in features/notebook) derive their limit from this single
// source so the page size and the cap can never drift apart.
export const LIST_PAGE_LIMIT = 200

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
  if (error !== undefined || data === undefined) {
    const retryAfter =
      response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
    throw toApiError(response.status, error, retryAfter)
  }
  return data
}

export async function list(): Promise<NotebookListItem[]> {
  // TARDIS-167 (#3): request newest-first by CREATION time, not by `updatedAt`.
  // The backend default is `sort=updatedAt&order=desc`, which re-orders the list
  // on every edit (a touched notebook jumps to the top after a reload). The
  // product order is "newest created first", so pass it explicitly. The backend
  // whitelist already accepts `createdAt`/`desc`, so this changes no contract.
  const data = await request<Schemas['NotebookListResponse']>(
    notebookClient.GET('/notebooks', {
      params: { query: { limit: LIST_PAGE_LIMIT, sort: 'createdAt', order: 'desc' } },
    }),
  )
  // Boundary validation (AGENTS §11): the 2xx body is typed but untrusted. A
  // schema drift or a garbage 2xx from an edge proxy could give us a body whose
  // `items` is not an array; returning it as-is crashes the first `.map()` down
  // the render stack. Fail loud as an ApiError the sync layer already catches.
  if (!Array.isArray(data.items)) {
    throw new ApiError(
      0,
      'malformed_response',
      'notebook.list: unexpected response shape (items is not an array)',
    )
  }
  if (data.items.length < data.total) {
    console.warn(
      `notebook.list: returned ${data.items.length} of ${data.total} notebooks; ` +
        `the tail is truncated at limit ${LIST_PAGE_LIMIT}. TODO(#135): pagination.`,
    )
  }
  return data.items
}

/**
 * Guarantee a `cells` array on a notebook response (AGENTS §11 boundary check).
 * `cells` is optional on the wire, so an absent (`undefined`) field defaults to
 * `[]` — the sync layer (#133+) can then `nb.cells.map(...)` without a null
 * check. Any other non-array value (`null`, a string, an object) is a contract
 * violation: we fail loud rather than coerce it, so a malformed 2xx cannot pose
 * as an empty notebook and look like authoritative "all cells deleted" state.
 */
function normalizeNotebook(data: Schemas['NotebookResponse']): Notebook {
  if (data.cells === undefined) return { ...data, cells: [] }
  if (!Array.isArray(data.cells)) {
    throw new ApiError(
      0,
      'malformed_response',
      'notebook: unexpected response shape (cells is present but not an array)',
    )
  }
  return { ...data, cells: data.cells }
}

export async function get(id: string, signal?: AbortSignal): Promise<Notebook> {
  const data = await request<Schemas['NotebookResponse']>(
    notebookClient.GET('/notebooks/{notebook_id}', {
      params: { path: { notebook_id: id } },
      signal,
    }),
  )
  return normalizeNotebook(data)
}

export async function create(input: CreateNotebookInput, signal?: AbortSignal): Promise<Notebook> {
  const body: Schemas['NotebookCreate'] = {
    title: input.title,
    formatVersion: input.formatVersion,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.cells !== undefined ? { cells: input.cells } : {}),
  }
  const data = await request<Schemas['NotebookResponse']>(
    notebookClient.POST('/notebooks', { body, signal }),
  )
  return normalizeNotebook(data)
}

export async function patch(
  id: string,
  input: UpdateNotebookInput,
  signal?: AbortSignal,
): Promise<Notebook> {
  const body: Schemas['NotebookPatch'] = {
    title: input.title,
    formatVersion: input.formatVersion,
    cells: input.cells,
    ...(input.deletedCells !== undefined ? { deletedCells: input.deletedCells } : {}),
  }
  const data = await request<Schemas['NotebookResponse']>(
    notebookClient.PATCH('/notebooks/{notebook_id}', {
      params: { path: { notebook_id: id } },
      body,
      signal,
    }),
  )
  return normalizeNotebook(data)
}

/**
 * Soft-delete a notebook (the server marks it deleted, does not erase it).
 * Named `remove`, not `delete`, since `delete` is a reserved word. Returns 204
 * with no body, so success is read from `response.ok` rather than `request`'s
 * data-or-throw unwrap; a rejected fetch still maps to NetworkError.
 */
export async function restoreFeaturesDemo(signal?: AbortSignal): Promise<Notebook> {
  const data = await request<Schemas['NotebookResponse']>(
    notebookClient.POST('/notebooks/features-demo/restore', { signal }),
  )
  return normalizeNotebook(data)
}

export async function remove(id: string): Promise<void> {
  let response: Response
  let error: unknown
  try {
    const result = await notebookClient.DELETE('/notebooks/{notebook_id}', {
      params: { path: { notebook_id: id } },
    })
    response = result.response
    error = result.error
  } catch (cause) {
    throw new NetworkError('Notebook request failed', cause)
  }
  if (!response.ok) {
    const retryAfter =
      response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
    throw toApiError(response.status, error, retryAfter)
  }
}
