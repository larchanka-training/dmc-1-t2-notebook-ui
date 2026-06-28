import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { peek } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { displayNameAtom } from '@/features/settings'
import { autoLoadModelAtom } from '@/features/web-llm'
import {
  IN_BROWSER_MAX_TOKENS,
  IN_BROWSER_THINK_TOKEN_BUDGET,
  inBrowserMaxTokensAtom,
  thinkTokenBudgetAtom,
} from '@/features/notebook'
import { userAtom } from '@/entities/session'
import SettingsPage from './SettingsPage'

// The shadcn/Base UI Select relies on scrollIntoView, which jsdom lacks
// (same stub as LlmPlaygroundPage.test.tsx).
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterAll(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView
})

afterEach(() => {
  displayNameAtom.set('')
  autoLoadModelAtom.set(false)
  inBrowserMaxTokensAtom.set(IN_BROWSER_MAX_TOKENS)
  thinkTokenBudgetAtom.set(IN_BROWSER_THINK_TOKEN_BUDGET)
  userAtom.set(null)
})

describe('SettingsPage (TARDIS-181)', () => {
  test('renders the Settings heading', () => {
    render(<SettingsPage />)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  test('renders all section titles, with two locked "Coming soon" sections', () => {
    render(<SettingsPage />)

    expect(screen.getByText('Display name')).toBeInTheDocument()
    expect(screen.getByText('Default LLM model')).toBeInTheDocument()
    expect(screen.getByText('Local model limits')).toBeInTheDocument()
    expect(screen.getByText('On start')).toBeInTheDocument()
    expect(screen.getByText('Passkey')).toBeInTheDocument()

    expect(screen.getAllByText('Coming soon')).toHaveLength(2)
  })

  test('typing into the Display name input updates displayNameAtom', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    await user.type(screen.getByLabelText('Display name'), 'Лора')

    expect(peek(displayNameAtom)).toBe('Лора')
  })

  test('the auto-load switch is enabled by default and toggles autoLoadModelAtom', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    const toggle = screen.getByRole('switch')
    expect(toggle).toBeEnabled()
    expect(peek(autoLoadModelAtom)).toBe(false)

    await user.click(toggle)

    expect(peek(autoLoadModelAtom)).toBe(true)
  })

  test('editing the Generation token limit input updates inBrowserMaxTokensAtom', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    const input = screen.getByLabelText('Generation token limit')
    await user.clear(input)
    await user.type(input, '4000')

    expect(peek(inBrowserMaxTokensAtom)).toBe(4000)
  })
})
