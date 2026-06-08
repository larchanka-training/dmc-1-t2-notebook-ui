import { describe, expect, test } from 'vitest'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import {
  activeMatchAtom,
  activeMatchIndexAtom,
  caseSensitiveAtom,
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

  test('case-sensitive mode matches only the exact casing', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'const total = TOTAL + Total')
    caseSensitiveAtom.set(true)
    setSearchQuery('total')
    // Only the lowercase "total" matches; "TOTAL" and "Total" are excluded.
    expect(searchMatchesAtom()).toHaveLength(1)
  })

  test('case-sensitive toggle widens results back when turned off', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'total TOTAL Total')
    caseSensitiveAtom.set(true)
    setSearchQuery('total')
    expect(searchMatchesAtom()).toHaveLength(1)
    // Flip it off → the default case-insensitive search sees all three.
    caseSensitiveAtom.set(false)
    expect(searchMatchesAtom()).toHaveLength(3)
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

  test('zero-length regex matches are skipped (no phantom counted hits)', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'aaa')
    useRegexAtom.set(true)
    // `a*` matches greedily then yields zero-length matches at each boundary;
    // only the one non-empty hit must be recorded, not the empty ones.
    setSearchQuery('a*')
    const matches = searchMatchesAtom()
    expect(matches.every((m) => m.length > 0)).toBe(true)
    expect(matches).toHaveLength(1)
  })

  test('activeMatch stays clamped when a live edit shrinks the results', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'foo foo foo')
    setSearchQuery('foo')
    nextMatch()
    nextMatch() // active index = 2 (the 3rd match)
    expect(matchCountLabelAtom()).toBe('3/3')
    // Edit the cell down to a single match WITHOUT resetting the active index
    // (setSearchQuery resets it, plain updateCellCode does not — the live-edit
    // case). The clamped active match must still resolve to the surviving one.
    updateCellCode(seed.id, 'foo')
    expect(searchMatchesAtom()).toHaveLength(1)
    const active = activeMatchAtom()
    expect(active).not.toBeNull()
    expect(active).toBe(searchMatchesAtom()[0])
    expect(matchCountLabelAtom()).toBe('1/1')
  })

  test('activeMatch is null when there are no matches', () => {
    const [seed] = cellsAtom()
    updateCellCode(seed.id, 'abc')
    setSearchQuery('zzz')
    expect(activeMatchAtom()).toBeNull()
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
