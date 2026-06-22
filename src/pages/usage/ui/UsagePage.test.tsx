import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEMO_NOTEBOOK_ID } from '@/features/notebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import { userAtom } from '@/entities/session'
import UsagePage from './UsagePage'

describe('UsagePage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    userAtom.set(null)
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

  test('public (signed-out) view shows examples but never the seed-restore block (TARDIS-167 №22)', async () => {
    userAtom.set(null)
    // Even if a local demo were somehow absent, a signed-out visitor must not see
    // the per-account restore block — and the per-owner demo id resolver must not
    // be called.
    const getSpy = vi.spyOn(notebookStorage, 'get')

    render(<UsagePage />)

    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restore demo/i })).not.toBeInTheDocument()
    expect(getSpy).not.toHaveBeenCalled()
  })
})
