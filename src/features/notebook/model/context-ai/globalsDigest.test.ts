import { describe, expect, test } from 'vitest'
import { reatomCell } from '../../domain/cell'
import { buildGlobalsDigest } from './globalsDigest'

const code = (src: string) => reatomCell(src, 'code')

describe('buildGlobalsDigest', () => {
  test('extracts declared globals with inferred types', () => {
    const digest = buildGlobalsDigest([
      code('const items = [{ category: "a" }]\nlet total = 0'),
      code('function groupBy(xs, key) { return xs }'),
      code('class Repo {}'),
    ])
    expect(digest).toContain('items: array[1]')
    expect(digest).toContain('total: number')
    expect(digest).toContain('groupBy: function')
    expect(digest).toContain('Repo: class')
    expect(digest.startsWith('globals: ')).toBe(true)
  })

  test('infers primitive, object and string shapes', () => {
    const digest = buildGlobalsDigest([
      code('const name = "x"; const flag = true; const cfg = { a: 1, b: 2 }; const t = `hi`'),
    ])
    expect(digest).toContain('name: string')
    expect(digest).toContain('flag: boolean')
    expect(digest).toContain('cfg: object{a,b}')
    expect(digest).toContain('t: string')
  })

  test('ignores markdown cells and tolerates unparseable code', () => {
    const digest = buildGlobalsDigest([
      reatomCell('# heading with const x = 1', 'markdown'),
      code('const broken = ('), // syntax error — skipped, not thrown
      code('const ok = 42'),
    ])
    expect(digest).toBe('globals: ok: number')
  })

  test('later declaration wins on name collision', () => {
    const digest = buildGlobalsDigest([code('const x = 1'), code('const x = [1, 2]')])
    expect(digest).toBe('globals: x: array[2]')
  })

  test('returns empty string when nothing is declared', () => {
    expect(buildGlobalsDigest([code('doSomething()')])).toBe('')
    expect(buildGlobalsDigest([])).toBe('')
  })

  test('TypeScript-only syntax yields an empty digest (acorn is JS-only, MVP limit)', () => {
    // Type annotations / interface / enum don't parse as JS → empty (documented).
    expect(buildGlobalsDigest([code('const x: number = 1')])).toBe('')
    expect(buildGlobalsDigest([code('interface Foo { a: number }')])).toBe('')
    // A plain-JS declaration alongside still works.
    expect(buildGlobalsDigest([code('const y: number = 1'), code('const z = 2')])).toBe(
      'globals: z: number',
    )
  })

  test('extracts binding names from destructuring declarations', () => {
    const digest = buildGlobalsDigest([
      code('const { a, b } = obj'),
      code('const [x, , z] = arr'),
      code('const { nested: { deep }, ...rest } = thing'),
      code('const [first = 1] = list'),
    ])
    for (const name of ['a', 'b', 'x', 'z', 'deep', 'rest', 'first']) {
      expect(digest).toContain(`${name}: unknown`)
    }
  })
})
