import { notebookClient } from './client'
import { NetworkError, parseRetryAfter, toApiError } from './errors'
import type { components } from './generated/openapi-ts/notebook'

// Typed facade over the per-notebook AI generation context sub-resource
// (`/notebooks/{id}/ai-context`, Epic 07 / #116). The endpoint lives under
// `/notebooks`, so its types are generated into the notebook client slice.
type Schemas = components['schemas']

/** The persisted, budget-fit AI context for a notebook (server roll-up applied). */
export type AiContext = Schemas['AiContextResponse']
/** The freshly built context the FE stores; the server rolls it up before saving. */
export type AiContextStoreInput = Schemas['AiContextStoreRequest']

async function request<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await call
  } catch (cause) {
    throw new NetworkError('AI context request failed', cause)
  }
  const { data, error, response } = result
  if (error !== undefined || data === undefined) {
    const retryAfter =
      response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
    throw toApiError(response.status, error, retryAfter)
  }
  return data
}

/** Read the stored context for a notebook (empty default when never built). */
export async function get(notebookId: string): Promise<AiContext> {
  return request<AiContext>(
    notebookClient.GET('/notebooks/{notebook_id}/ai-context', {
      params: { path: { notebook_id: notebookId } },
    }),
  )
}

/** Store the built context; the server rolls it up to the generation budget. */
export async function put(notebookId: string, input: AiContextStoreInput): Promise<AiContext> {
  return request<AiContext>(
    notebookClient.PUT('/notebooks/{notebook_id}/ai-context', {
      params: { path: { notebook_id: notebookId } },
      body: input,
    }),
  )
}

/** Clear the stored context (used by the rebuild-on-delete flow). 204, no body. */
export async function clear(notebookId: string): Promise<void> {
  let response: Response
  let error: unknown
  try {
    const result = await notebookClient.DELETE('/notebooks/{notebook_id}/ai-context', {
      params: { path: { notebook_id: notebookId } },
    })
    response = result.response
    error = result.error
  } catch (cause) {
    throw new NetworkError('AI context request failed', cause)
  }
  if (!response.ok) {
    const retryAfter =
      response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
    throw toApiError(response.status, error, retryAfter)
  }
}
