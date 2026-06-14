// Regression (review gpt-v-10): the title focus handler reads an atom from a
// React event boundary, so it must be `wrap`-captured. Production enables
// `clearStack()` (src/setup.ts), under which a bare atom read in an unwrapped
// handler throws `missing async stack` — breaking title editing and Escape
// rollback. The shared test setup does NOT enable clearStack (it would break the
// direct-atom-access tests in NotebookHeader.test.tsx), so this file emulates the
// production invariant per test — the same approach as autosave.repro.test.ts.
import { afterEach, describe, expect, test } from 'vitest'
import { clearStack, context, STACK } from '@reatom/core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NotebookHeader } from './NotebookHeader'
import { setNotebookTitle } from '../model/notebook'

afterEach(() => {
  cleanup()
  // Re-seed the global stack emptied by clearStack() so the shared
  // context.reset() teardown (it calls top()) doesn't throw.
  if (STACK.length === 0) STACK.push(context.start())
})

describe('NotebookHeader under production clearStack', () => {
  test('focusing the title does not throw (the onFocus atom read is wrapped)', async () => {
    await act(async () => setNotebookTitle('My notebook'))
    render(<NotebookHeader />)
    const title = screen.getByRole('textbox', { name: /notebook title/i })

    // React invokes event handlers asynchronously and reports a handler throw via
    // the global `error` event rather than re-throwing from `focus()` — so capture
    // it there. Unwrapped, the onFocus atom read throws `missing async stack`
    // under clearStack; wrapped, it re-establishes a stack and stays silent.
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onError)
    try {
      clearStack()
      await act(async () => {
        title.focus()
      })
    } finally {
      window.removeEventListener('error', onError)
    }
    expect(errors).toEqual([])
  })
})
