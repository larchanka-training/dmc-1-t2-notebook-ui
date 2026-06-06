import { notebookClient } from './client'
import { toApiError } from './errors'
import type { components } from './generated/openapi-ts/notebook'

export type Notebook = components['schemas']['Notebook']
export type NotebookListItem = components['schemas']['NotebookListItem']
export type Cell = components['schemas']['Cell']
export type CellStatus = components['schemas']['CellStatus']
export type CellRunResult = components['schemas']['CellRunResult']
export type CreateNotebookRequest = components['schemas']['CreateNotebookRequest']

export async function list(): Promise<NotebookListItem[]> {
  const { data, error, response } = await notebookClient.GET('/notebooks')
  if (error !== undefined || !data) throw toApiError(response.status, error)
  // GET /notebooks is paginated: { items, total, limit, offset }. Callers want
  // the rows; pagination metadata is not used yet.
  return data.items
}

export async function create(body: CreateNotebookRequest): Promise<Notebook> {
  const { data, error, response } = await notebookClient.POST('/notebooks', { body })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}

export async function runCell(notebookId: string, cellId: string): Promise<CellRunResult> {
  const { data, error, response } = await notebookClient.POST(
    '/notebooks/{notebookId}/cells/{cellId}/run',
    { params: { path: { notebookId, cellId } } },
  )
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}
