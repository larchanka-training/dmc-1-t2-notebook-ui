import { describe, expect, test } from 'vitest'
import { transformCellCode } from './transform'

describe('transformCellCode — top-level declarations are exposed via __ctx', () => {
  test('const declaration is moved to __ctx and shadowed locally', () => {
    const out = transformCellCode('const x = 1', {})
    // Local `const x` must remain valid (so existing references work),
    // and __ctx.x must end up with the value.
    expect(out.code).toContain('__ctx.x =')
    expect(out.code).toContain('const x =')
  })

  test('let declaration', () => {
    const out = transformCellCode('let y = 2', {})
    expect(out.code).toContain('__ctx.y =')
    expect(out.code).toMatch(/\blet y\b/)
  })

  test('var declaration', () => {
    const out = transformCellCode('var z = 3', {})
    expect(out.code).toContain('__ctx.z =')
    expect(out.code).toMatch(/\bvar z\b/)
  })

  test('multiple declarations in one statement', () => {
    const out = transformCellCode('const a = 1, b = 2', {})
    expect(out.code).toContain('__ctx.a =')
    expect(out.code).toContain('__ctx.b =')
  })

  test('function declaration', () => {
    const out = transformCellCode('function greet() { return 1 }', {})
    expect(out.code).toContain('__ctx.greet =')
    // Should keep the function available locally as well.
    expect(out.code).toMatch(/function greet/)
  })

  test('nested declarations inside a block are NOT lifted', () => {
    const out = transformCellCode('if (true) { const inner = 1 }', {})
    expect(out.code).not.toContain('__ctx.inner')
  })
})

describe('transformCellCode — prelude inlines previous scope', () => {
  test('prelude binds every incoming key as a local const', () => {
    const out = transformCellCode('console.log(prev)', { prev: 7 })
    expect(out.code).toMatch(/const prev = globalThis\.__ctx\.prev/)
    // and original code is preserved after the prelude
    expect(out.code).toContain('console.log(prev)')
  })

  test('skips invalid identifiers in the incoming scope', () => {
    // A key like "1bad" or " with space" can't be a JS identifier; the
    // transform must drop it from the prelude (a hard error would block
    // unrelated cells from running).
    const out = transformCellCode('1', { '1bad': 1, ok: 2 })
    expect(out.code).not.toContain('1bad')
    expect(out.code).toContain('const ok = globalThis.__ctx.ok')
  })

  test('empty scope produces no prelude bindings', () => {
    const out = transformCellCode('1', {})
    expect(out.code).not.toContain('globalThis.__ctx.')
  })
})

describe('transformCellCode — trailing expression statement', () => {
  test('rewrites trailing ExpressionStatement into a return', () => {
    const out = transformCellCode('1 + 2', {})
    expect(out.code).toMatch(/return\s+1 \+ 2/)
  })

  test('does not add return if the last statement is not an expression', () => {
    const out = transformCellCode('const a = 1', {})
    expect(out.code).not.toMatch(/^return/m)
  })

  test('does not touch return inside a function declaration', () => {
    const out = transformCellCode('function f(){ return 1 }', {})
    // there should be exactly one `return 1` — the original inside f
    const matches = out.code.match(/return 1/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe('transformCellCode — syntax errors are surfaced', () => {
  test('throws SyntaxError on garbage input', () => {
    expect(() => transformCellCode('this is not js', {})).toThrow()
  })
})
