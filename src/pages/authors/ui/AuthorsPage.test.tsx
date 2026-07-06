import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthorsPage from './AuthorsPage'

describe('AuthorsPage', () => {
  test('renders the heading, the mentor and every team member', () => {
    render(<AuthorsPage />)

    expect(screen.getByRole('heading', { name: 'Authors' })).toBeInTheDocument()

    // Mentor block: name + role description, no coding claim.
    expect(screen.getByText('Mikhail Larchanka')).toBeInTheDocument()
    expect(screen.getByText(/ideological inspirer and organizer/i)).toBeInTheDocument()

    for (const name of [
      'Siarhei Luskanau',
      'Grigorii Averkin',
      'Irina Ser.',
      'Larisa Morozhnikova',
      'Akzhol',
      'Oleg',
      'Marat',
      'Yuriy Bugakov',
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  test('links every author to their GitHub profile (new tab, no referrer)', () => {
    render(<AuthorsPage />)

    const handles = [
      'larchanka',
      'siarhei-luskanau',
      'Computer-God',
      'IrinaSer',
      'lmoroz',
      'aokzhl',
      'okoleg',
      'MaratGaZa',
      'SvyatoKod',
    ]
    for (const handle of handles) {
      const link = screen.getByRole('link', { name: new RegExp(`@${handle}`, 'i') })
      expect(link).toHaveAttribute('href', `https://github.com/${handle}`)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    }
  })
})
