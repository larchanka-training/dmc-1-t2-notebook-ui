import type { llm } from '@/shared/api'
import type { CellKind } from '../domain/cell'

export function cellKindForLlmResult(response: llm.GenerateCodeResponse): CellKind {
  return response.resultKind === 'text' ? 'markdown' : 'code'
}
