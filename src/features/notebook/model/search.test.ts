import { describe, expect, test } from 'vitest'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import {
  activeMatchIndexAtom,
  closeSearch,
  matchCountLabelAtom,
  nextMatch,
  prevMatch,
  searchMatchesAtom,
  setSearchQuery,
  useRegexAtom,
} from './search'

describe('notebook search', () => {
  test('finds case-insensitive matches across all cells', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'const total = 1')
    const b = addCell()
    updateCellCode(b.id, 'TOTAL += total')

    setSearchQuery('total')
    const matches = searchMatchesAtom()
    // "total" in cell A once, "TOTAL" + "total" in cell B
    expect(matches).toHaveLength(3)
    expect(matches.every((m) => m.length === 5)).toBe(true)
  })

  test('reports a 1-based counter label', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'a a a')
    setSearchQuery('a')
    expect(matchCountLabelAtom()).toBe('1/3')
    nextMatch()
    expect(matchCountLabelAtom()).toBe('2/3')
  })

  test('next/prev wrap around', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'x x')
    setSearchQuery('x')
    expect(activeMatchIndexAtom()).toBe(0)
    prevMatch() // wrap to last
    expect(activeMatchIndexAtom()).toBe(1)
    nextMatch() // wrap to first
    expect(activeMatchIndexAtom()).toBe(0)
  })

  test('empty query yields no matches', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'anything')
    setSearchQuery('')
    expect(searchMatchesAtom()).toEqual([])
    expect(matchCountLabelAtom()).toBe('0/0')
  })

  test('regex mode matches patterns', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'foo1 foo2 bar')
    useRegexAtom.set(true)
    setSearchQuery('foo\\d')
    expect(searchMatchesAtom()).toHaveLength(2)
  })

  test('invalid regex is treated as no matches, not an error', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'abc')
    useRegexAtom.set(true)
    setSearchQuery('(') // unbalanced
    expect(searchMatchesAtom()).toEqual([])
  })

  test('closeSearch resets query and active index', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'z z z')
    setSearchQuery('z')
    nextMatch()
    closeSearch()
    expect(searchMatchesAtom()).toEqual([])
    expect(activeMatchIndexAtom()).toBe(0)
  })
})
