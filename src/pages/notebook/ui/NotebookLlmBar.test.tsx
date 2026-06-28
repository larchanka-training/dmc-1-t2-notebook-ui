import { afterEach, describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { engineAtom, isReasoningModel, MODEL_CATALOG } from '@/features/web-llm'
import { NotebookLlmBar } from './NotebookLlmBar'

afterEach(() => {
  act(() => {
    engineAtom.set(null)
  })
})

describe('NotebookLlmBar — model capabilities UI (TARDIS-168 C3/C4)', () => {
  test('the Cpu icon is grey when no engine is loaded and green when one is', () => {
    const { container, rerender } = render(<NotebookLlmBar />)
    // No engine → muted (grey).
    const cpuIdle = container.querySelector('svg')
    expect(cpuIdle?.getAttribute('class')).toContain('text-muted-foreground')

    act(() => {
      engineAtom.set({} as never)
      rerender(<NotebookLlmBar />)
    })
    const cpuReady = container.querySelector('svg')
    expect(cpuReady?.getAttribute('class')).toContain('text-green-600')
  })

  test('shows no "thinking" badge while the catalog has no reasoning models', () => {
    render(<NotebookLlmBar />)
    // The R1-Distill family was dropped (TARDIS-168), so no catalog model is
    // flagged reasoning and the badge never renders.
    expect(MODEL_CATALOG.some((m) => m.reasoning)).toBe(false)
    expect(screen.queryByText('thinking')).not.toBeInTheDocument()
  })

  test('isReasoningModel detects the DeepSeek-R1 family by name, not plain models', () => {
    // Intrinsic to the R1 family even though it is not in the current catalog.
    expect(isReasoningModel('DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC')).toBe(true)
    const plain = MODEL_CATALOG[0]
    expect(isReasoningModel(plain.id)).toBe(false)
    expect(isReasoningModel(null)).toBe(false)
    expect(isReasoningModel('not-in-catalog')).toBe(false)
  })
})
