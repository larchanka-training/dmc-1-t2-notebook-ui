import { describe, expect, test } from 'vitest'
import { transformCellCode } from './transform'

describe('transformCellCode — top-level declarations become globalThis slots', () => {
  test('const declaration writes through to globalThis with no local binding', () => {
    const out = transformCellCode('const x = 1').code
    expect(out).toContain('globalThis.x = (1)')
    // No lexical binding survives — there must be no `const x` keyword left.
    expect(out).not.toMatch(/\bconst x\b/)
  })

  test('let declaration', () => {
    const out = transformCellCode('let y = 2').code
    expect(out).toContain('globalThis.y = (2)')
    expect(out).not.toMatch(/\blet y\b/)
  })

  test('var declaration', () => {
    const out = transformCellCode('var z = 3').code
    expect(out).toContain('globalThis.z = (3)')
    expect(out).not.toMatch(/\bvar z\b/)
  })

  test('declaration with no initializer defaults to undefined', () => {
    const out = transformCellCode('let pending').code
    expect(out).toContain('globalThis.pending = (undefined)')
  })

  test('multiple declarations in one statement assign each binding', () => {
    const out = transformCellCode('const a = 1, b = 2').code
    expect(out).toContain('globalThis.a = (1)')
    expect(out).toContain('globalThis.b = (2)')
  })

  test('function declaration becomes a named expression on globalThis', () => {
    const out = transformCellCode('function greet() { return 1 }').code
    expect(out).toContain('globalThis.greet = function greet')
  })

  test('class declaration becomes a named expression on globalThis', () => {
    const out = transformCellCode('class Box {}').code
    expect(out).toContain('globalThis.Box = class Box')
  })

  test('object destructuring targets globalThis slots', () => {
    const out = transformCellCode('const { a, b: c } = obj').code
    expect(out).toContain('a: globalThis.a')
    expect(out).toContain('b: globalThis.c')
  })

  test('array destructuring with rest targets globalThis slots', () => {
    const out = transformCellCode('const [first, ...rest] = arr').code
    expect(out).toContain('globalThis.first')
    expect(out).toContain('...globalThis.rest')
  })

  test('nested declarations inside a block are NOT touched', () => {
    const out = transformCellCode('if (true) { const inner = 1 }').code
    expect(out).not.toContain('globalThis.inner')
    expect(out).toContain('const inner = 1')
  })
})

describe('transformCellCode — no prelude / re-run safety', () => {
  test('produces no __ctx prelude (scope lives in the VM now)', () => {
    const out = transformCellCode('console.log(prev)').code
    expect(out).not.toContain('__ctx')
    expect(out).toContain('console.log(prev)')
  })

  test('re-running a const cell is a re-assignment, never a redeclaration', () => {
    // No `const`/`let`/`var` keyword is emitted for a top-level declaration,
    // so running the same cell twice can never throw a redeclaration error.
    const out = transformCellCode('const x = 1').code
    expect(out).not.toMatch(/\b(const|let|var)\b/)
    expect(out).toContain('globalThis.x = (1)')
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

  test('throws a readable error on dynamic import()', () => {
    expect(() => transformCellCode('const m = await import("x")')).toThrow(
      /import is not supported/,
    )
  })

  test('throws a readable error on import.meta', () => {
    expect(() => transformCellCode('console.log(import.meta.url)')).toThrow(
      /import is not supported/,
    )
  })
})
