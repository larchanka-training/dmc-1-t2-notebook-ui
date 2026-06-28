import { afterEach, describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import {
  thinkingSessionAtom,
  startThinkingAction,
  updateThinkingAction,
  failThinkingAction,
} from '../model/inBrowserThinking'
import { interruptInBrowserAtom, IN_BROWSER_MAX_TOKENS } from '../model/codeGenerator'
import { ThinkingBlock } from './ThinkingBlock'

afterEach(() => {
  act(() => {
    thinkingSessionAtom.set(null)
    interruptInBrowserAtom.set(null)
  })
})

describe('ThinkingBlock', () => {
  test('renders nothing when there is no active session', () => {
    const { container } = render(<ThinkingBlock />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows the streamed reasoning and the live token counter while thinking', () => {
    act(() => {
      startThinkingAction('cell-1')
      updateThinkingAction('Let me plan the pie chart…', 42)
    })
    render(<ThinkingBlock />)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(screen.getByText(/plan the pie chart/)).toBeInTheDocument()
    // Counter shows generated / max tokens, secondary styling. Assert against
    // the live cap (IN_BROWSER_MAX_TOKENS) so a budget change doesn't break this.
    expect(screen.getByText(`42 / ${IN_BROWSER_MAX_TOKENS} tokens`)).toBeInTheDocument()
  })

  test('Stop asks the engine to interrupt and marks the session stopping', async () => {
    const user = userEvent.setup()
    const interrupt = vi.fn().mockResolvedValue(undefined)
    act(() => {
      interruptInBrowserAtom.set(() => interrupt)
      startThinkingAction('cell-1')
      updateThinkingAction('looping…', 10)
    })
    render(<ThinkingBlock />)

    await user.click(screen.getByRole('button', { name: /^stop$/i }))
    expect(interrupt).toHaveBeenCalledOnce()
    expect(thinkingSessionAtom()?.stopRequested).toBe(true)
    // The button reflects the stopping state.
    expect(screen.getByText('Stopping…')).toBeInTheDocument()
  })

  test('switches to a dismissable failure notice when generation failed', async () => {
    const user = userEvent.setup()
    act(() => {
      startThinkingAction(null)
      failThinkingAction()
    })
    render(<ThinkingBlock />)
    expect(screen.getByText(/couldn.t generate runnable code/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(thinkingSessionAtom()).toBeNull()
  })

  test('shows a reason-specific recovery hint on failure (M2)', () => {
    act(() => {
      startThinkingAction(null)
      failThinkingAction('degenerate')
    })
    render(<ThinkingBlock />)
    // The degenerate-loop hint, not the generic "try rephrasing" fallback.
    expect(screen.getByText(/kept reasoning without finishing/i)).toBeInTheDocument()
  })
})
