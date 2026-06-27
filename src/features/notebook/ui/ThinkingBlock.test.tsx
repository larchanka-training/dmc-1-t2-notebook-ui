import { afterEach, describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  thinkingSessionAtom,
  startThinkingAction,
  updateThinkingAction,
  failThinkingAction,
} from '../model/inBrowserThinking'
import { ThinkingBlock } from './ThinkingBlock'

afterEach(() => {
  act(() => {
    thinkingSessionAtom.set(null)
  })
})

describe('ThinkingBlock', () => {
  test('renders nothing when there is no active session', () => {
    const { container } = render(<ThinkingBlock />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows the streamed reasoning while thinking', () => {
    act(() => {
      startThinkingAction('cell-1')
      updateThinkingAction('Let me plan the pie chart…')
    })
    render(<ThinkingBlock />)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(screen.getByText(/plan the pie chart/)).toBeInTheDocument()
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
})
