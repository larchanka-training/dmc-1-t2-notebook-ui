import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userAtom } from '@/entities/session'
import { notebookListResource } from '@/features/notebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import DashboardPage from './DashboardPage'

// NOTE: renders here may emit React "not wrapped in act(...)" warnings from
// @reatom/react's async scheduler — a repo-wide artefact, not a failure (see
// SettingsPage.test.tsx).
//
// The card-list logic (server⊕local merge, metadata, offline fallback, empty
// input, floor dedupe, ordering) is unit-tested exhaustively in
// `dashboardData.test.ts` against the pure `mergeDashboardCards`. These page
// tests cover only what the component itself owns and can assert
// deterministically: the header and the auth gate. (Driving the async
// `dashboardNotebooksResource` to a settled state in jsdom is timing-fragile,
// so card rendering is verified at the model layer instead.)

const USER = { id: 'owner-A', email: 'a@b.com', displayName: null, roles: [] }

beforeEach(async () => {
  await notebookStorage.clearAll()
  notebookListResource.data.set([])
  userAtom.set(USER as never)
})

afterEach(async () => {
  await notebookStorage.clearAll()
  notebookListResource.data.set([])
  userAtom.set(null)
})

describe('DashboardPage (TARDIS-183)', () => {
  test('renders the page header', () => {
    render(<DashboardPage />)
    expect(screen.getByRole('heading', { name: 'Your notebooks' })).toBeInTheDocument()
  })

  test('renders nothing when signed out (auth gate, no list fetch)', () => {
    userAtom.set(null)
    const { container } = render(<DashboardPage />)
    expect(container).toBeEmptyDOMElement()
  })
})
