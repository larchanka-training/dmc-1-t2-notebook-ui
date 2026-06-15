import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notebook as notebookApi } from '@/shared/api'
import { DEMO_NOTEBOOK_ID } from '@/features/notebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import UsagePage from './UsagePage'

describe('UsagePage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders the actual output contract and sandbox guidance', () => {
    render(<UsagePage />)
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByText(/OutputItem\[\]/)).toBeInTheDocument()
    expect(screen.getByText('console.log')).toBeInTheDocument()
    expect(screen.getByText('console.warn')).toBeInTheDocument()
    expect(screen.getByText('fetch')).toBeInTheDocument()
    expect(screen.getByText(/raw base64 without a/i)).toBeInTheDocument()
    expect(screen.getAllByText(/canvas/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/lives only in this browser/i)).toBeInTheDocument()
  })

  test('renders a copy button for every runnable example', () => {
    render(<UsagePage />)

    expect(screen.getAllByRole('button', { name: /^copy$/i })).toHaveLength(8)
  })

  test('shows non-blocking feedback after copying an example', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<UsagePage />)

    await user.click(screen.getAllByRole('button', { name: /^copy$/i })[0])

    expect(writeText).toHaveBeenCalledWith('const x = 2 + 2\nx')
    expect(await screen.findByRole('button', { name: /copied!/i })).toBeInTheDocument()
  })

  test('hides restore button when the demo notebook exists locally', async () => {
    vi.spyOn(notebookStorage, 'get').mockResolvedValue({
      id: DEMO_NOTEBOOK_ID,
      title: '📗 My first notebook, full of features',
      formatVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      cells: [],
    })

    render(<UsagePage />)

    expect(screen.queryByRole('button', { name: /restore demo/i })).not.toBeInTheDocument()
  })

  test('restore button uses the shared notebook API facade', async () => {
    const user = userEvent.setup()
    vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
    vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    vi.spyOn(notebookApi, 'restoreFeaturesDemo').mockResolvedValue({
      id: 'bf6f2f5d-9d1e-5e9d-a71d-e8247b073860',
      ownerId: 'owner-1',
      title: '📗 My first notebook, full of features',
      formatVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      cells: [],
    })
    render(<UsagePage />)

    await user.click(await screen.findByRole('button', { name: /restore demo/i }))

    expect(notebookApi.restoreFeaturesDemo).toHaveBeenCalledTimes(1)
  })
})
