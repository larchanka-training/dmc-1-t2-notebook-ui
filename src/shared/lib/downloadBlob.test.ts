import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { downloadBlob } from './downloadBlob'

describe('downloadBlob', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-url')
  const revokeObjectURL = vi.fn()
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL

  beforeEach(() => {
    vi.useFakeTimers()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    vi.useRealTimers()
  })

  test('creates an <a download>, clicks it, then removes it from the DOM', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadBlob(blob, 'hello.txt')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // The anchor must not linger in the DOM after the click.
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })

  test('defers revokeObjectURL to the next tick (Safari quirk)', () => {
    const blob = new Blob(['x'])
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadBlob(blob, 'x.txt')

    // Same tick: not yet revoked, otherwise Safari may cancel the download.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
