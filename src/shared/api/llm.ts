import { llmClient } from './client'
import { parseRetryAfter, toApiError } from './errors'
import type { components } from './generated/openapi-ts/llm'

type GeneratedGenerateCodeRequest = components['schemas']['GenerateRequest']

export type GenerateCodeRequest = Omit<
  GeneratedGenerateCodeRequest,
  'context' | 'language' | 'mode'
> &
  Partial<Pick<GeneratedGenerateCodeRequest, 'context' | 'language' | 'mode'>>
export type GenerateCodeResponse = components['schemas']['GenerateResponse']
export type LlmContextCell = components['schemas']['LlmContextCell']

/**
 * Send a code-generation request to the backend Cloud LLM agent.
 *
 * Defaults `context`, `language` and `mode` if the caller omits them.
 * Explicit `undefined` values from the caller are also ignored so the
 * defaults survive (this is what `??` does below; a plain object spread
 * would let `{ language: undefined }` clobber the default).
 *
 * On 429 the thrown error is a `RateLimitedError` whose `retryAfter`
 * field is populated from the `Retry-After` response header. Other
 * statuses surface through their usual error subclasses.
 */
export async function generateCode(body: GenerateCodeRequest): Promise<GenerateCodeResponse> {
  const requestBody: GeneratedGenerateCodeRequest = {
    prompt: body.prompt,
    context: body.context ?? [],
    language: body.language ?? 'javascript',
    mode: body.mode ?? 'generate',
    ...(body.notebookTitle !== undefined ? { notebookTitle: body.notebookTitle } : {}),
    ...(body.baseCode !== undefined ? { baseCode: body.baseCode } : {}),
  }
  const { data, error, response } = await llmClient.POST('/llm/generate', { body: requestBody })
  if (error !== undefined || !data) {
    const retryAfter =
      response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
    throw toApiError(response.status, error, retryAfter)
  }
  return data
}
