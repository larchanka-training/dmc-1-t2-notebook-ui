import { describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsHelp, shortcutsOpenAtom } from './ShortcutsHelp'

describe('ShortcutsHelp', () => {
  test('? opens the dialog', async () => {
    const user = userEvent.setup()
    render(<ShortcutsHelp />)
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull()
    await user.keyboard('?')
    expect(await screen.findByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('opens when shortcutsOpenAtom is set (sidebar Help button path)', async () => {
    render(<ShortcutsHelp />)
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull()
    await act(async () => shortcutsOpenAtom.set(true))
    expect(await screen.findByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('Escape closes the open dialog', async () => {
    const user = userEvent.setup()
    render(<ShortcutsHelp />)
    await act(async () => shortcutsOpenAtom.set(true))
    expect(await screen.findByText('Keyboard shortcuts')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(shortcutsOpenAtom()).toBe(false)
  })
})
