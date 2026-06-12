import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as aiContextApi from '@/shared/api/aiContext'
import type { LlmContextCell } from '@/shared/api'
import { reatomCell } from '../../domain/cell'
import { cellsAtom, deleteCell, updateCellCode } from '../notebook'
import { aiContextModeAtom } from './aiContextMode'
import {
  applyCellContextChanges,
  assembleGenerationContext,
  clearAndRebuildContext,
  contextLoadFailedAtom,
  loadPersistedContext,
  persistedContextAtom,
  resetAiContextSync,
  scheduleContextRebuild as rebuild,
  startAiContextSync,
  whenContextReady,
} from './aiContext'

vi.mock('@/shared/api/aiContext', () => ({
  get: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
}))

const NB = '00000000-0000-4000-8000-000000000001'

function stored(context: LlmContextCell[] = []) {
  return { notebookId: NB, context, summary: '', historyCount: context.length, updatedAt: 1 }
}

beforeEach(() => {
  resetAiContextSync()
  aiContextModeAtom.set('persisted')
  cellsAtom.set([reatomCell('const x = 1', 'code', 'c1')])
  vi.mocked(aiContextApi.put).mockResolvedValue(stored())
  vi.mocked(aiContextApi.get).mockResolvedValue(stored([{ kind: 'code', source: 'saved' }]))
  vi.mocked(aiContextApi.clear).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('scheduleContextRebuild', () => {
  test('builds the current context and persists it', async () => {
    rebuild(NB)
    await whenContextReady()
    expect(aiContextApi.put).toHaveBeenCalledTimes(1)
    const [notebookId, body] = vi.mocked(aiContextApi.put).mock.calls[0]
    expect(notebookId).toBe(NB)
    expect(body.context?.some((c) => c.source === 'const x = 1')).toBe(true)
    expect(persistedContextAtom()).not.toBeNull()
  })

  test('serializes concurrent rebuilds in order', async () => {
    const order: number[] = []
    vi.mocked(aiContextApi.put).mockImplementation(async () => {
      order.push(order.length + 1)
      return stored()
    })
    rebuild(NB)
    rebuild(NB)
    rebuild(NB)
    await whenContextReady()
    expect(order).toEqual([1, 2, 3])
    expect(aiContextApi.put).toHaveBeenCalledTimes(3)
  })
})

describe('clearAndRebuildContext', () => {
  test('clears then rebuilds as one ordered unit', async () => {
    const calls: string[] = []
    vi.mocked(aiContextApi.clear).mockImplementation(async () => {
      calls.push('clear')
    })
    vi.mocked(aiContextApi.put).mockImplementation(async () => {
      calls.push('put')
      return stored()
    })
    clearAndRebuildContext(NB)
    await whenContextReady()
    expect(calls).toEqual(['clear', 'put'])
  })
})

describe('loadPersistedContext', () => {
  test('loads the saved context into the atom', async () => {
    await loadPersistedContext(NB)
    expect(aiContextApi.get).toHaveBeenCalledWith(NB)
    expect(persistedContextAtom()?.context?.[0]?.source).toBe('saved')
    expect(contextLoadFailedAtom()).toBe(false)
  })

  test('on failure: flags it and leaves context null (FE fallback), never throws', async () => {
    vi.mocked(aiContextApi.get).mockRejectedValue(new Error('network down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(loadPersistedContext(NB)).resolves.toBeNull()
    expect(contextLoadFailedAtom()).toBe(true)
    expect(persistedContextAtom()).toBeNull()
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('applyCellContextChanges (incremental)', () => {
  test('recomputes only the changed cell and keeps the others', async () => {
    cellsAtom.set([reatomCell('const a = 1', 'code', 'a'), reatomCell('const b = 2', 'code', 'b')])
    // Seed both contributions.
    rebuild(NB)
    await whenContextReady()

    // Edit only cell 'a', then apply an incremental change for it.
    const cellA = cellsAtom().find((c) => c.id === 'a')!
    cellA.code.set('const a = 999')
    applyCellContextChanges(NB, ['a'])
    await whenContextReady()

    const lastBody = vi.mocked(aiContextApi.put).mock.calls.at(-1)![1]
    const sources = lastBody.context?.map((c) => c.source) ?? []
    // The edited cell's new source is present, and the untouched cell survives.
    expect(sources).toContain('const a = 999')
    expect(sources).toContain('const b = 2')
    expect(sources).not.toContain('const a = 1')
  })
})

describe('startAiContextSync', () => {
  // The revision subscriber enqueues asynchronously, so flush the task queue
  // (timer + microtasks) before draining the serialized build queue.
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await whenContextReady()
  }

  test('loads on entry without overwriting it; rebuilds on edit; clears on delete', async () => {
    cellsAtom.set([reatomCell('const a = 1', 'code', 'a'), reatomCell('const b = 2', 'code', 'b')])
    const unsubscribe = startAiContextSync(NB)
    await settle()
    expect(aiContextApi.get).toHaveBeenCalledWith(NB) // load on entry
    expect(aiContextApi.put).not.toHaveBeenCalled() // NO immediate PUT over the loaded state

    vi.clearAllMocks()
    vi.mocked(aiContextApi.put).mockResolvedValue(stored())
    vi.mocked(aiContextApi.clear).mockResolvedValue(undefined)

    // An edit rebuilds without clearing.
    updateCellCode('a', 'const a = 99')
    await settle()
    expect(aiContextApi.clear).not.toHaveBeenCalled()
    expect(aiContextApi.put).toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(aiContextApi.put).mockResolvedValue(stored())
    vi.mocked(aiContextApi.clear).mockResolvedValue(undefined)

    // A delete clears then rebuilds.
    deleteCell('b')
    await settle()
    expect(aiContextApi.clear).toHaveBeenCalled()
    expect(aiContextApi.put).toHaveBeenCalled()

    unsubscribe()
  })

  test('rapid edits coalesce into a single debounced PUT', async () => {
    cellsAtom.set([reatomCell('const a = 1', 'code', 'a')])
    const unsubscribe = startAiContextSync(NB)
    await settle()
    vi.clearAllMocks()
    vi.mocked(aiContextApi.put).mockResolvedValue(stored())

    updateCellCode('a', 'const a = 1; const a1 = 1')
    updateCellCode('a', 'const a = 1; const a2 = 2')
    updateCellCode('a', 'const a = 1; const a3 = 3')
    await settle() // subscribers accumulate, then the debounce flushes once
    expect(aiContextApi.put).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  test('generation is cell-aware (only cells above the prompt) with live outputs', async () => {
    cellsAtom.set([
      reatomCell('aboveValue', 'code', 'above'),
      reatomCell('promptText', 'code', 'prompt'),
      reatomCell('belowValue', 'code', 'below'),
    ])
    const unsubscribe = startAiContextSync(NB)
    await settle()

    // A run sets an output on the cell above (does NOT bump the revision).
    cellsAtom()
      .find((c) => c.id === 'above')!
      .output.set([{ type: 'stdout', text: 'ran-output' }])

    const gen = assembleGenerationContext('prompt')
    const sources = gen.map((c) => c.source)
    expect(sources).toContain('aboveValue') // cell above the prompt
    expect(sources).not.toContain('promptText') // the prompt cell itself excluded
    expect(sources).not.toContain('belowValue') // "future" cell below excluded
    // Live output is included at generation time (not cached).
    expect(gen.some((c) => c.kind === 'output' && c.source.includes('ran-output'))).toBe(true)

    unsubscribe()
  })

  test('the persisted store PUT excludes outputs (they would go stale)', async () => {
    cellsAtom.set([reatomCell('const a = 1', 'code', 'a')])
    cellsAtom()[0].output.set([{ type: 'stdout', text: 'ran-output' }])
    const unsubscribe = startAiContextSync(NB)
    await settle()
    vi.clearAllMocks()
    vi.mocked(aiContextApi.put).mockResolvedValue(stored())

    updateCellCode('a', 'const a = 2')
    await settle()
    const body = vi.mocked(aiContextApi.put).mock.calls.at(-1)![1]
    expect(body.context?.some((c) => c.kind === 'output')).toBe(false)

    unsubscribe()
  })

  test('load failed + backend down: context stays incremental (not rebuilt from scratch)', async () => {
    // Whole backend is down: GET and PUT both fail.
    vi.mocked(aiContextApi.get).mockRejectedValue(new Error('down'))
    vi.mocked(aiContextApi.put).mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    cellsAtom.set([reatomCell('const a = 1', 'code', 'a'), reatomCell('const b = 2', 'code', 'b')])
    const unsubscribe = startAiContextSync(NB)
    await settle()

    // Load failed → flagged, no persisted context, but the local working model
    // was seeded from the cells.
    expect(contextLoadFailedAtom()).toBe(true)
    expect(persistedContextAtom()).toBeNull()
    let gen = assembleGenerationContext()
    expect(gen.some((c) => c.source === 'const a = 1')).toBe(true)
    expect(gen.some((c) => c.source === 'const b = 2')).toBe(true)

    // An edit updates only that cell's contribution; the send-side working model
    // reflects it incrementally (the old value is gone, the other cell stays).
    updateCellCode('a', 'const a = 42')
    await settle()
    gen = assembleGenerationContext()
    expect(gen.some((c) => c.source === 'const a = 42')).toBe(true)
    expect(gen.some((c) => c.source === 'const a = 1')).toBe(false)
    expect(gen.some((c) => c.source === 'const b = 2')).toBe(true)

    unsubscribe()
  })
})
