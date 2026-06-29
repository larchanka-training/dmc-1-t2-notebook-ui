import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { peek } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// NOTE: these interaction tests emit React "update not wrapped in act(...)"
// warnings. That is a repo-wide artefact of `@reatom/react` re-rendering via
// Reatom's own async scheduler (outside React's act window) — the same warning
// appears in the pre-existing LlmPlaygroundPage.test.tsx. The assertions below
// read the atom directly via `peek`, which is what the test verifies; silencing
// the warning cleanly belongs to a shared test-harness change, not here.
import { displayNameAtom } from '@/features/settings'
import { autoLoadModelAtom } from '@/features/web-llm'
import {
  IN_BROWSER_MAX_TOKENS,
  IN_BROWSER_THINK_TOKEN_BUDGET,
  MAX_IN_BROWSER_MAX_TOKENS,
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

  test('clearing the Generation token limit keeps the current value, not 0', async () => {
    const user = userEvent.setup()
    inBrowserMaxTokensAtom.set(3000)
    render(<SettingsPage />)

    // Fully clearing the field must NOT persist 0 (Number('') === 0): it falls
    // back to the current value instead.
    await user.clear(screen.getByLabelText('Generation token limit'))

    expect(peek(inBrowserMaxTokensAtom)).toBe(3000)
  })

  test('an out-of-range Generation token limit is clamped to MAX on blur', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    const input = screen.getByLabelText('Generation token limit')
    await user.clear(input)
    await user.type(input, '50000')
    // Above MAX while typing (raw is kept so the user isn't fought mid-edit)…
    expect(peek(inBrowserMaxTokensAtom)).toBe(50000)
    // …but blur normalises both the atom and the visible field to MAX.
    await user.tab()
    expect(peek(inBrowserMaxTokensAtom)).toBe(MAX_IN_BROWSER_MAX_TOKENS)
    expect(input).toHaveValue(MAX_IN_BROWSER_MAX_TOKENS)
  })
})
