import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { llm } from '@/shared/api'
import { ApiError, RateLimitedError } from '@/shared/api/errors'
import { cellsAtom } from '../model/notebook'
import { agentChatOpenAtom, agentSendAction, openAgentChatAction } from '../model/agentChat'
import { codeGeneratorAtom } from '../model/codeGenerator'
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
    fireEvent.click(screen.getByRole('button', { name: /^cloud$/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /^cloud$/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /^cloud$/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /^cloud$/i }))
    await act(async () => {})

    expect(screen.getByText(/generation failed/i)).toBeInTheDocument()
    expect(agentChatOpenAtom()).toBe(true)
  })
})

describe('AgentChatDialog — two agent tiers (TARDIS-167 №13)', () => {
  afterEach(() => {
    act(() => codeGeneratorAtom.set(null))
  })

  test('the in-browser button is disabled until a model is loaded', async () => {
    render(<AgentChatDialog />)
    await act(async () => {
      codeGeneratorAtom.set(null)
      agentChatOpenAtom.set(true)
    })
    expect(screen.getByRole('button', { name: /in-browser/i })).toBeDisabled()
    // The cloud tier stays available regardless of a local model.
    expect(screen.getByRole('button', { name: /^cloud$/i })).not.toBeDisabled()
  })

  test('in-browser button generates via the injected local generator (no cloud call)', async () => {
    const user = userEvent.setup()
    const cloudSpy = vi.spyOn(llm, 'generateCode')
    const generator = vi.fn().mockResolvedValue('const local = 1')
    const cellsBefore = cellsAtom().length

    render(<AgentChatDialog />)
    await act(async () => {
      codeGeneratorAtom.set(() => generator)
      agentChatOpenAtom.set(true)
    })

    await user.type(screen.getByRole('textbox'), 'make a local var')
    fireEvent.click(screen.getByRole('button', { name: /in-browser/i }))
    await act(async () => {})

    expect(generator).toHaveBeenCalledWith('make a local var')
    expect(cloudSpy).not.toHaveBeenCalled()
    expect(cellsAtom().length).toBe(cellsBefore + 1)
    expect(cellsAtom().at(-1)?.code()).toBe('const local = 1')
    expect(agentChatOpenAtom()).toBe(false)
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
