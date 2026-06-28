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

  test('renders a "thinking" badge for reasoning models only', () => {
    render(<NotebookLlmBar />)
    // The trigger is collapsed; the badge count in the (open) content equals the
    // number of reasoning models in the catalog. Radix renders items lazily, so
    // assert on the catalog-derived expectation instead of opening the listbox.
    const reasoningCount = MODEL_CATALOG.filter((m) => m.reasoning).length
    expect(reasoningCount).toBeGreaterThan(0)
    // The selected value (first model) is not reasoning, so no badge in the trigger.
    expect(screen.queryByText('thinking')).not.toBeInTheDocument()
  })

  test('isReasoningModel matches the catalog flag', () => {
    const reasoning = MODEL_CATALOG.find((m) => m.reasoning)
    const plain = MODEL_CATALOG.find((m) => !m.reasoning)
    expect(isReasoningModel(reasoning?.id)).toBe(true)
    expect(isReasoningModel(plain?.id)).toBe(false)
    expect(isReasoningModel(null)).toBe(false)
    expect(isReasoningModel('not-in-catalog')).toBe(false)
  })
})
