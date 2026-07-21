import { describe, expect, test } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { lazyRoutePage } from './lazyRoutePage'

describe('lazyRoutePage', () => {
  test('shows the fallback, then renders the resolved page', async () => {
    // A deferred loader lets us observe the Suspense fallback before it resolves.
    let resolve!: (m: { default: () => React.ReactElement }) => void
    const renderPage = lazyRoutePage(() => new Promise((r) => (resolve = r)))

    render(renderPage())

    // Fallback is visible while the chunk "loads".
    expect(screen.getByRole('status')).toBeInTheDocument()

    resolve({ default: () => <div>Loaded page</div> })

    await waitFor(() => expect(screen.getByText('Loaded page')).toBeInTheDocument())
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('returns a stable component identity across calls', () => {
    // lazy() is created once, at helper-call time — invoking the returned render
    // function repeatedly must not create a new lazy component (which would remount).
    const renderPage = lazyRoutePage(async () => ({ default: () => <div>P</div> }))
    const suspenseProps = (el: React.ReactElement) =>
      (el.props as { children: React.ReactElement }).children.type
    expect(suspenseProps(renderPage())).toBe(suspenseProps(renderPage()))
  })
})
