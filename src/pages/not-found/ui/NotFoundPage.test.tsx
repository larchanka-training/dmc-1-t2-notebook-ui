import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NotFoundPage } from '../index'

afterEach(() => {
  cleanup()
})

describe('NotFoundPage (TARDIS-167 №14)', () => {
  test('renders the 404 heading and an accessible "404" label', () => {
    render(<NotFoundPage />)
    expect(screen.getByText('Page not found')).toBeInTheDocument()
    expect(screen.getByLabelText('404')).toBeInTheDocument()
  })

  test('shows the requested path and navigation actions', () => {
    render(<NotFoundPage />)
    // The requested path is surfaced so the user sees what failed to resolve.
    expect(screen.getByText('requested:')).toBeInTheDocument()
    // A link back to the notebook (home) and a Back button.
    expect(screen.getByRole('link', { name: /notebook/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })
})
