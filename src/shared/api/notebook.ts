import { notebookClient } from './client'
import { toApiError } from './errors'
import type { components } from './generated/openapi-ts/notebook'

// TARDIS-131: thin temporary shim over the regenerated backend contract. It
// exposes just enough surface for existing callers to compile; the full typed
// sync facade (get / patch / delete + offline queue) lands in #132.
export type Notebook = components['schemas']['NotebookResponse']
export type NotebookListItem = components['schemas']['NotebookListItem']
export type CreateNotebookRequest = Pick<components['schemas']['NotebookCreate'], 'title'>

export async function list(): Promise<NotebookListItem[]> {
  // GET /notebooks is paginated ({ items, total, limit, offset }); this shim
  // reads a single page. Request the server max (200) so users with many
  // notebooks are not silently truncated. TODO(#135): real pagination/bootstrap.
  const { data, error, response } = await notebookClient.GET('/notebooks', {
    params: { query: { limit: 200 } },
  })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data.items
}

export async function create(body: CreateNotebookRequest): Promise<Notebook> {
  // formatVersion has a server-side default but openapi-typescript types it as
  // required, so send the default explicitly. #132 carries the real value.
  const { data, error, response } = await notebookClient.POST('/notebooks', {
    body: { ...body, formatVersion: 1 },
  })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}
