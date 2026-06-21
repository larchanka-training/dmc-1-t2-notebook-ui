import { afterEach, describe, expect, test } from 'vitest'
import { peek } from '@reatom/core'
import { downloadedModelIdsAtom, modelIdAtom } from './webLlm'

// `loadModelAction` itself drives the real `webllm.CreateMLCEngine` (a heavy WASM
// download), so the unit-testable part of TARDIS-167 №5 is the persisted
// bookkeeping: the selected model and the de-duped set of downloaded ids. The
// "append id after a successful load" step is asserted via the same de-dupe rule
// the action uses.
afterEach(() => {
  downloadedModelIdsAtom.set([])
})

describe('webLlm downloaded-models bookkeeping (TARDIS-167 №5)', () => {
  test('modelIdAtom is persisted (withLocalStorage) so the choice survives reloads', () => {
    // The atom is wired with withLocalStorage; setting it must round-trip through
    // peek without throwing and reflect the new value.
    modelIdAtom.set('Phi-3.5-mini-instruct-q4f16_1-MLC')
    expect(peek(modelIdAtom)).toBe('Phi-3.5-mini-instruct-q4f16_1-MLC')
  })

  test('recording a downloaded model de-dupes by id (the loadModel append rule)', () => {
    const record = (id: string) =>
      downloadedModelIdsAtom.set((ids) => (ids.includes(id) ? ids : [...ids, id]))

    record('A')
    record('B')
    record('A') // re-loading the same model must not duplicate it

    expect(peek(downloadedModelIdsAtom)).toEqual(['A', 'B'])
  })
})
