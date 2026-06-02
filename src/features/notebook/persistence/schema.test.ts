import { describe, expect, test } from 'vitest'
import { assertNotebookJSON, FORMAT_VERSION, isNotebookJSON, type NotebookJSON } from './schema'

function validNotebook(): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Untitled',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    cells: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        kind: 'code',
        content: 'console.log(1)',
        updatedAt: 1_700_000_000_000,
      },
    ],
  }
}

describe('notebook schema validator', () => {
  test('accepts a well-formed notebook', () => {
    expect(isNotebookJSON(validNotebook())).toBe(true)
  })

  test('accepts an empty cells array', () => {
    expect(isNotebookJSON({ ...validNotebook(), cells: [] })).toBe(true)
  })

  test('rejects non-objects', () => {
    expect(isNotebookJSON(null)).toBe(false)
    expect(isNotebookJSON(undefined)).toBe(false)
    expect(isNotebookJSON('{}')).toBe(false)
    expect(isNotebookJSON(42)).toBe(false)
  })

  test('rejects a missing/invalid top-level field', () => {
    const noTitle: Record<string, unknown> = { ...validNotebook() }
    delete noTitle['title']
    expect(isNotebookJSON(noTitle)).toBe(false)
    // ISO string instead of epoch ms — the drift we are guarding against.
    expect(isNotebookJSON({ ...validNotebook(), updatedAt: '2023-11-14' })).toBe(false)
  })

  test('rejects a cell with the wrong kind', () => {
    const nb = validNotebook()
    expect(isNotebookJSON({ ...nb, cells: [{ ...nb.cells[0], kind: 'text' }] })).toBe(false)
  })

  test('rejects a cell whose id is not a UUID', () => {
    // A broken client-side id fallback (non-secure origin) used to leak short
    // random strings; the backend contract is `format: uuid`, so reject them
    // at the boundary rather than letting them through to sync.
    const nb = validNotebook()
    expect(isNotebookJSON({ ...nb, cells: [{ ...nb.cells[0], id: 'k3n9xqz' }] })).toBe(false)
  })

  test('rejects a notebook whose id is not a UUID', () => {
    expect(isNotebookJSON({ ...validNotebook(), id: 'not-a-uuid' })).toBe(false)
  })

  test('rejects a cell with a non-number updatedAt', () => {
    const nb = validNotebook()
    expect(isNotebookJSON({ ...nb, cells: [{ ...nb.cells[0], updatedAt: '0' }] })).toBe(false)
  })

  test('rejects a cell missing content', () => {
    const nb = validNotebook()
    const noContent: Record<string, unknown> = { ...nb.cells[0] }
    delete noContent['content']
    expect(isNotebookJSON({ ...nb, cells: [noContent] })).toBe(false)
  })

  test('assertNotebookJSON throws on invalid input', () => {
    expect(() => assertNotebookJSON({})).toThrow(/Invalid notebook JSON/)
  })

  test('assertNotebookJSON passes through valid input', () => {
    expect(() => assertNotebookJSON(validNotebook())).not.toThrow()
  })
})
