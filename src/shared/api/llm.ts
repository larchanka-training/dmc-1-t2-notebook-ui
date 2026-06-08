import { llmClient } from './client'
import { toApiError } from './errors'
import type { components } from './generated/openapi-ts/llm'

type GeneratedGenerateCodeRequest = components['schemas']['GenerateRequest']

export type GenerateCodeRequest = Omit<
  GeneratedGenerateCodeRequest,
  'context' | 'language' | 'mode'
> &
  Partial<Pick<GeneratedGenerateCodeRequest, 'context' | 'language' | 'mode'>>
export type GenerateCodeResponse = components['schemas']['GenerateResponse']
export type LlmContextCell = components['schemas']['LlmContextCell']

export async function generateCode(body: GenerateCodeRequest): Promise<GenerateCodeResponse> {
  const requestBody: GeneratedGenerateCodeRequest = {
    context: [],
    language: 'javascript',
    mode: 'generate',
    ...body,
  }
  const { data, error, response } = await llmClient.POST('/llm/generate', { body: requestBody })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}
