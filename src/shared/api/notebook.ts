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
  const { data, error, response } = await notebookClient.GET('/notebooks')
  if (error !== undefined || !data) throw toApiError(response.status, error)
  // GET /notebooks is paginated: { items, total, limit, offset }. Callers want
  // the rows; pagination metadata is not used yet.
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
