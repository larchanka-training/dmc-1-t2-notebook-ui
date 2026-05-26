import { describe, expect, test } from 'vitest'
import { transformCellCode } from './transform'

describe('transformCellCode — top-level declarations publish to globalThis', () => {
  test('const declaration is kept and published', () => {
    const out = transformCellCode('const x = 1').code
    expect(out).toMatch(/const x = 1/)
    expect(out).toContain('globalThis.x = x')
  })

  test('let declaration', () => {
    const out = transformCellCode('let y = 2').code
    expect(out).toMatch(/\blet y = 2\b/)
    expect(out).toContain('globalThis.y = y')
  })

  test('var declaration', () => {
    const out = transformCellCode('var z = 3').code
    expect(out).toMatch(/\bvar z = 3\b/)
    expect(out).toContain('globalThis.z = z')
  })

  test('multiple declarations in one statement publish each binding', () => {
    const out = transformCellCode('const a = 1, b = 2').code
    expect(out).toContain('globalThis.a = a')
    expect(out).toContain('globalThis.b = b')
  })

  test('function declaration is published', () => {
    const out = transformCellCode('function greet() { return 1 }').code
    expect(out).toMatch(/function greet/)
    expect(out).toContain('globalThis.greet = greet')
  })

  test('class declaration is published', () => {
    const out = transformCellCode('class Box {}').code
    expect(out).toMatch(/class Box/)
    expect(out).toContain('globalThis.Box = Box')
  })

  test('object destructuring publishes every bound name', () => {
    const out = transformCellCode('const { a, b: c } = obj').code
    expect(out).toContain('globalThis.a = a')
    expect(out).toContain('globalThis.c = c')
  })

  test('array destructuring with rest publishes every bound name', () => {
    const out = transformCellCode('const [first, ...rest] = arr').code
    expect(out).toContain('globalThis.first = first')
    expect(out).toContain('globalThis.rest = rest')
  })

  test('nested declarations inside a block are NOT published', () => {
    const out = transformCellCode('if (true) { const inner = 1 }').code
    expect(out).not.toContain('globalThis.inner')
  })
})

describe('transformCellCode — no prelude / re-run safety', () => {
  test('produces no __ctx prelude (scope lives in the VM now)', () => {
    const out = transformCellCode('console.log(prev)').code
    expect(out).not.toContain('__ctx')
    expect(out).toContain('console.log(prev)')
  })

  test('re-running a const cell does not duplicate the declaration', () => {
    // The same source transformed twice yields a single `const x` each time;
    // there is no injected `const x` from a prelude that would clash.
    const out = transformCellCode('const x = 1').code
    const matches = out.match(/const x =/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe('transformCellCode — trailing expression statement', () => {
  test('rewrites trailing ExpressionStatement into a return', () => {
    const out = transformCellCode('1 + 2').code
    expect(out).toMatch(/return\s+1 \+ 2/)
  })

  test('does not add return if the last statement is not an expression', () => {
    const out = transformCellCode('const a = 1').code
    expect(out).not.toMatch(/^return/m)
  })

  test('does not touch return inside a function declaration', () => {
    const out = transformCellCode('function f(){ return 1 }').code
    const matches = out.match(/return 1/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe('transformCellCode — unsupported syntax surfaces clear errors', () => {
  test('throws on garbage input', () => {
    expect(() => transformCellCode('this is not js')).toThrow()
  })

  test('throws a readable error on import', () => {
    expect(() => transformCellCode('import x from "y"')).toThrow(/import is not supported/)
  })

  test('throws a readable error on export', () => {
    expect(() => transformCellCode('export const x = 1')).toThrow(/export is not supported/)
  })
})
