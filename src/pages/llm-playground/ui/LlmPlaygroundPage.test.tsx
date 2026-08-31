import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { llm } from '@/shared/api'
import { engineAtom, messagesAtom } from '@/features/web-llm'
import { cloudMessagesAtom } from '../model/cloudPlayground'
import LlmPlaygroundPage from './LlmPlaygroundPage'

const fakeResponse = (content: string): llm.GenerateCodeResponse => ({
  resultKind: 'code',
  content,
  model: 'test-model',
  tier: 'backend',
  tokens: { prompt: 4, completion: 6 },
  requestId: 'req-page',
})

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterAll(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView
})

beforeEach(() => {
  engineAtom.set(null)
  messagesAtom.set([])
  cloudMessagesAtom.set([])
  vi.restoreAllMocks()
})

afterEach(() => {
  engineAtom.set(null)
  messagesAtom.set([])
  cloudMessagesAtom.set([])
  vi.restoreAllMocks()
})

describe('LlmPlaygroundPage', () => {
  test('renders local and cloud comparison panels', () => {
    render(<LlmPlaygroundPage />)

    expect(screen.getByRole('heading', { name: 'LLM Playground' })).toBeInTheDocument()
    expect(screen.getByText('Local (In-Browser)')).toBeInTheDocument()
    // Renamed in Step 8d-2: the vendor name moved out of the UI when the backend
    // gained a config-selected provider adapter.
    expect(screen.getByText('Cloud AI')).toBeInTheDocument()
    expect(screen.getByText('Load a model to enable local responses.')).toBeInTheDocument()
    expect(screen.getByText('Cloud responses will appear here.')).toBeInTheDocument()
  })

  test('sends one prompt to local placeholder and cloud response', async () => {
    const user = userEvent.setup()
    const cloudSpy = vi.spyOn(llm, 'generateCode').mockResolvedValue(fakeResponse('cloud reply'))
    render(<LlmPlaygroundPage />)

    const input = screen.getByPlaceholderText(/send a message to both models/i)
    await user.type(input, 'compare map and reduce')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(cloudSpy).toHaveBeenCalledOnce())
    expect(cloudSpy).toHaveBeenCalledWith({
      prompt: 'compare map and reduce',
      language: 'javascript',
      mode: 'generate',
    })

    expect(screen.getAllByText('compare map and reduce')).toHaveLength(2)
    expect(screen.getByText('— Load a model to see a local response —')).toBeInTheDocument()
    expect(await screen.findByText('cloud reply')).toBeInTheDocument()
  })
})

// Step 8d-2: the cloud tier is in limited testing and the page must say so.
describe('LlmPlaygroundPage — cloud beta messaging', () => {
  test('labels the cloud panel as Beta and explains what that means', () => {
    render(<LlmPlaygroundPage />)

    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText(/limited testing/i)).toBeInTheDocument()
  })

  test('no longer names a specific cloud vendor', () => {
    // The backend picks the adapter from config (Step 8d-1), so a vendor name in
    // the UI goes stale the moment it is switched.
    render(<LlmPlaygroundPage />)

    expect(screen.queryByText(/bedrock/i)).not.toBeInTheDocument()
  })
})
