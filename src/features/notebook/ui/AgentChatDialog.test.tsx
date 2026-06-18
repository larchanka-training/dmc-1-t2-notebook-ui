import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { llm } from '@/shared/api'
import { ApiError, RateLimitedError } from '@/shared/api/errors'
import { cellsAtom } from '../model/notebook'
import { agentChatOpenAtom, agentSendAction, openAgentChatAction } from '../model/agentChat'
import { AgentChatDialog } from './AgentChatDialog'

// Minimal GenerateResponse so mocks satisfy the return type.
const fakeResponse = (
  content: string,
  resultKind: llm.GenerateCodeResponse['resultKind'] = 'code',
): llm.GenerateCodeResponse => ({
  resultKind,
  content,
  model: 'test-model',
  tier: 'backend',
  tokens: { prompt: 10, completion: 5 },
  requestId: 'req-1',
})

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgentChatDialog — open / close', () => {
  test('is not rendered when closed', () => {
    render(<AgentChatDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('appears when agentChatOpenAtom is set to true', async () => {
    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/ask agent/i)).toBeInTheDocument()
  })

  test('Cancel button closes the dialog without calling generateCode', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(llm, 'generateCode')
    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(agentChatOpenAtom()).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  test('Esc key closes the dialog (onOpenChange wrapped in wrap)', async () => {
    const user = userEvent.setup()
    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })
    await user.keyboard('{Escape}')
    // If handleOpenChange was not wrapped, this would throw ReatomError:
    // missing async stack instead of closing.
    expect(agentChatOpenAtom()).toBe(false)
  })

  test('openAgentChatAction stores the afterId and opens the dialog', async () => {
    render(<AgentChatDialog />)
    await act(async () => {
      openAgentChatAction('cell-abc')
    })
    expect(agentChatOpenAtom()).toBe(true)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('AgentChatDialog — code generation', () => {
  test('sends prompt to llm.generateCode and inserts a code cell below', async () => {
    const user = userEvent.setup()
    vi.spyOn(llm, 'generateCode').mockResolvedValue(fakeResponse('const x = 42'))
    const cellsBefore = cellsAtom().length

    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })

    await user.type(screen.getByRole('textbox'), 'create a variable')
    await user.click(screen.getByRole('button', { name: /generate code/i }))
    await act(async () => {})

    expect(llm.generateCode).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'create a variable', language: 'javascript' }),
    )
    expect(cellsAtom().length).toBe(cellsBefore + 1)
    expect(cellsAtom().at(-1)?.code()).toBe('const x = 42')
    // Dialog closes after successful insert
    expect(agentChatOpenAtom()).toBe(false)
  })

  test('inserts a markdown cell when backend returns text', async () => {
    const user = userEvent.setup()
    vi.spyOn(llm, 'generateCode').mockResolvedValue(
      fakeResponse('Closures keep access to outer scope.', 'text'),
    )
    const cellsBefore = cellsAtom().length

    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })

    await user.type(screen.getByRole('textbox'), 'explain closures')
    await user.click(screen.getByRole('button', { name: /generate code/i }))
    await act(async () => {})

    expect(cellsAtom().length).toBe(cellsBefore + 1)
    const inserted = cellsAtom().at(-1)!
    expect(inserted.kind).toBe('markdown')
    expect(inserted.code()).toBe('Closures keep access to outer scope.')
    expect(agentChatOpenAtom()).toBe(false)
  })

  test('Enter key in textarea also triggers generation', async () => {
    const user = userEvent.setup()
    vi.spyOn(llm, 'generateCode').mockResolvedValue(fakeResponse('console.log("hi")'))

    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })

    await user.type(screen.getByRole('textbox'), 'log hi{Enter}')
    await act(async () => {})

    expect(llm.generateCode).toHaveBeenCalledOnce()
    expect(agentChatOpenAtom()).toBe(false)
  })

  test('shows safety-filter error and keeps dialog open for retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(llm, 'generateCode').mockRejectedValue(
      new ApiError(422, 'prompt_rejected', 'prompt_rejected'),
    )

    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })

    await user.type(screen.getByRole('textbox'), 'bad prompt')
    await user.click(screen.getByRole('button', { name: /generate code/i }))
    await act(async () => {})

    expect(screen.getByText(/flagged by the safety filter/i)).toBeInTheDocument()
    // Dialog stays open so the user can retry
    expect(agentChatOpenAtom()).toBe(true)
  })

  test('shows generic error for non-safety failures', async () => {
    const user = userEvent.setup()
    vi.spyOn(llm, 'generateCode').mockRejectedValue(new Error('Network error'))

    render(<AgentChatDialog />)
    await act(async () => {
      agentChatOpenAtom.set(true)
    })

    await user.type(screen.getByRole('textbox'), 'anything')
    await user.click(screen.getByRole('button', { name: /generate code/i }))
    await act(async () => {})

    expect(screen.getByText(/generation failed/i)).toBeInTheDocument()
    expect(agentChatOpenAtom()).toBe(true)
  })
})

describe('AgentChatDialog — cloud generate action (model level)', () => {
  test('rate-limited error is stored in agentSendAction.error()', async () => {
    vi.spyOn(llm, 'generateCode').mockRejectedValue(
      new RateLimitedError('rate_limited', 'rate limited', 30),
    )

    await act(async () => {
      agentChatOpenAtom.set(true)
      try {
        await agentSendAction('anything')
      } catch {
        /* expected */
      }
    })

    const err = agentSendAction.error()
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).retryAfter).toBe(30)
  })
})
