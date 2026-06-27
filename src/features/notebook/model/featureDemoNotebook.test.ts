import { describe, expect, test } from 'vitest'
import { createKernel } from '../runtime/quickjs'
import type { OutputItem } from '../runtime/types'
import { DEMO_CELLS, SEED_TITLE } from './featureDemoNotebook'

// The feature-demo notebook (TARDIS-67) is a *runnable* product tour, so its
// guarantee is not "the strings look nice" but "every code cell runs and the
// notebook actually emits every output channel we advertise". These tests run
// the real demo content through one persistent QuickJS kernel — the same engine
// the editor uses — in cell order, exactly like a user pressing Run-all.

const codeCells = DEMO_CELLS.filter((cell) => cell.kind === 'code')

/** Run every code cell in order through ONE shared-scope kernel (Run-all). */
async function runDemoCells(): Promise<OutputItem[]> {
  const kernel = await createKernel()
  const items: OutputItem[] = []
  try {
    for (const cell of codeCells) {
      const result = await kernel.run(cell.content)
      items.push(...result.items)
    }
  } finally {
    kernel.dispose()
  }
  return items
}

describe('feature-demo notebook content', () => {
  test('first cell is the Welcome markdown (asserted by slot/boot tests)', () => {
    expect(DEMO_CELLS[0].kind).toBe('markdown')
    expect(DEMO_CELLS[0].content.startsWith('# Welcome to JS Notebook')).toBe(true)
  })

  test('title is the feature-demo seed title', () => {
    expect(SEED_TITLE).toBe('📗 My first notebook, full of features')
  })

  test('mixes markdown and code cells with unique ids', () => {
    const ids = DEMO_CELLS.map((cell) => cell.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(DEMO_CELLS.some((cell) => cell.kind === 'markdown')).toBe(true)
    expect(codeCells.length).toBeGreaterThan(1)
  })

  test('every code cell runs without an unexpected error (the thrown-error demo aside)', async () => {
    const kernel = await createKernel()
    try {
      for (const cell of codeCells) {
        const result = await kernel.run(cell.content)
        const isErrorDemo = cell.content.includes('throw new Error')
        if (isErrorDemo) {
          expect(result.status).toBe('error')
        } else {
          expect(result.status, `cell ${cell.id} should run cleanly`).toBe('done')
        }
      }
    } finally {
      kernel.dispose()
    }
  })

  test('the running notebook emits every output channel we advertise', async () => {
    const items = await runDemoCells()
    const types = new Set(items.map((item) => item.type))
    // stdout / stderr / result / html / image / error — the full set.
    expect(types).toContain('stdout')
    expect(types).toContain('stderr')
    expect(types).toContain('result')
    expect(types).toContain('html')
    expect(types).toContain('image')
    expect(types).toContain('error')
  })

  test('the SVG bar chart cell produces real <rect> bars from data', async () => {
    const items = await runDemoCells()
    const html = items.filter((item) => item.type === 'html')
    expect(html.some((item) => item.type === 'html' && item.html.includes('<rect'))).toBe(true)
  })

  test('the image cell ships a valid base64 PNG (raw, no data: prefix)', async () => {
    const items = await runDemoCells()
    const image = items.find((item) => item.type === 'image')
    expect(image?.type === 'image' && image.mime).toBe('image/png')
    if (image?.type === 'image') {
      expect(image.data.startsWith('data:')).toBe(false)
      // Decode the base64 payload and check the PNG magic bytes (89 50 4E 47).
      const head = atob(image.data).slice(0, 4)
      expect([...head].map((c) => c.charCodeAt(0))).toEqual([0x89, 0x50, 0x4e, 0x47])
    }
  })

  test('shared scope survives across cells (a const from one cell is read in the next)', async () => {
    const items = await runDemoCells()
    // The 3rd code cell prints "This notebook = JS Notebook with code + text cells"
    // using `launch` defined in the 2nd code cell.
    const stdout = items.filter((item) => item.type === 'stdout')
    const resultStrings = items
      .filter((item) => item.type === 'result')
      .map((item) => JSON.stringify(item))
    const all = [...stdout.map((s) => (s.type === 'stdout' ? s.text : '')), ...resultStrings]
    expect(all.some((text) => text.includes('JS Notebook with code + text cells'))).toBe(true)
  })
})
