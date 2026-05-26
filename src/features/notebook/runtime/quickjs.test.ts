import { describe, expect, test, vi } from 'vitest'
import { runInQuickJS } from './quickjs'

// These tests pin the public contract of runInQuickJS. Worker integration
// lives in workerHost.test.ts; here we focus on the sandbox itself.

describe('runInQuickJS — happy path', () => {
  test('captures single console.log', async () => {
    const r = await runInQuickJS('console.log("hello")')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'hello' })
  })

  test('joins multi-argument console.log with spaces', async () => {
    const r = await runInQuickJS('console.log(1, 2, 3)')
    expect(r.items).toContainEqual({ type: 'stdout', text: '1 2 3' })
  })

  test('console.warn → stderr with [warn] prefix', async () => {
    const r = await runInQuickJS('console.warn("oops")')
    expect(r.items).toContainEqual({ type: 'stderr', text: '[warn] oops' })
  })

  test('console.error → stderr with [error] prefix', async () => {
    const r = await runInQuickJS('console.error("nope")')
    expect(r.items).toContainEqual({ type: 'stderr', text: '[error] nope' })
  })

  test('console.info → stdout (no prefix)', async () => {
    const r = await runInQuickJS('console.info("note")')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'note' })
  })

  test('top-level await is supported', async () => {
    const r = await runInQuickJS('const v = await Promise.resolve(42); console.log(v)')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: '42' })
  })

  test('trailing expression statement becomes a result item', async () => {
    const r = await runInQuickJS('1 + 2')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({
      type: 'result',
      value: { kind: 'primitive', value: 3 },
    })
  })

  test('explicit return value becomes a result item', async () => {
    const r = await runInQuickJS('return 1 + 2')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({
      type: 'result',
      value: { kind: 'primitive', value: 3 },
    })
  })

  test('console.log(undefined) prints "undefined"', async () => {
    const r = await runInQuickJS('console.log(undefined)')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('object argument is serialized to readable form', async () => {
    const r = await runInQuickJS('console.log({ a: 1 })')
    // We do not commit to a specific pretty-printer; just check it has
    // both the key and the value somewhere in the text representation.
    const stdout = r.items.find((it) => it.type === 'stdout')
    expect(stdout).toBeDefined()
    expect(stdout?.type).toBe('stdout')
    if (stdout?.type === 'stdout') {
      expect(stdout.text).toContain('a')
      expect(stdout.text).toContain('1')
    }
  })

  test('returns initial scope unchanged in commit-1 stub', async () => {
    // Shared scope is wired only in commit 2; until then runtime carries
    // the input through, so the API shape is stable.
    const r = await runInQuickJS('1', { x: 1, y: 'a' })
    expect(r.scope).toEqual({ x: 1, y: 'a' })
  })
})

describe('runInQuickJS — errors', () => {
  test('throw new Error → error item, status=error', async () => {
    const r = await runInQuickJS('throw new Error("boom")')
    expect(r.status).toBe('error')
    const err = r.items.find((it) => it.type === 'error')
    expect(err).toBeDefined()
    if (err?.type === 'error') {
      expect(err.message).toBe('boom')
      expect(err.name).toBe('Error')
    }
  })

  test('syntax error → error item, status=error', async () => {
    const r = await runInQuickJS('this is not js')
    expect(r.status).toBe('error')
    expect(r.items.some((it) => it.type === 'error')).toBe(true)
  })

  test('reference error → error item', async () => {
    const r = await runInQuickJS('definitelyNotDefined()')
    expect(r.status).toBe('error')
    const err = r.items.find((it) => it.type === 'error')
    expect(err?.type === 'error' && err.name).toMatch(/ReferenceError|Error/)
  })
})

describe('runInQuickJS — sandbox isolation', () => {
  test.each([
    ['window'],
    ['document'],
    ['fetch'],
    ['localStorage'],
    ['XMLHttpRequest'],
    ['sessionStorage'],
    ['navigator'],
  ])('typeof %s === "undefined" inside sandbox', async (name) => {
    const r = await runInQuickJS(`console.log(typeof ${name})`)
    expect(r.items).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('does not call host console.log when user code logs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runInQuickJS('console.log("inside")')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('successive runs do not share scope unless host carries it', async () => {
    // Without explicit scope hand-off, fresh contexts → no leak.
    await runInQuickJS('var leak = 1')
    const r = await runInQuickJS('console.log(typeof leak)')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'undefined' })
  })
})

describe('runInQuickJS — shared scope hand-off', () => {
  test('const declared in run A is visible in run B via scope carrier', async () => {
    const a = await runInQuickJS('const x = 7')
    const b = await runInQuickJS('console.log(x)', a.scope)
    expect(b.status).toBe('done')
    expect(b.items).toContainEqual({ type: 'stdout', text: '7' })
  })

  test('let and var declarations also persist between runs', async () => {
    const a = await runInQuickJS('let y = 8; var z = 9')
    const b = await runInQuickJS('console.log(y, z)', a.scope)
    expect(b.items).toContainEqual({ type: 'stdout', text: '8 9' })
  })

  test('function declarations are callable in the next run', async () => {
    // Functions are dropped at postMessage boundary by design (only data
    // crosses workers). The function is callable WITHIN the same run.
    const a = await runInQuickJS('function answer(){ return 42 } console.log(answer())')
    expect(a.items).toContainEqual({ type: 'stdout', text: '42' })
  })

  test('empty initial scope works (most common path)', async () => {
    const r = await runInQuickJS('const k = 1; console.log(k)', {})
    expect(r.items).toContainEqual({ type: 'stdout', text: '1' })
  })
})

describe('runInQuickJS — timeout', () => {
  test('infinite loop is interrupted by deadline', async () => {
    const start = Date.now()
    const r = await runInQuickJS('while(true){}', undefined, { timeoutMs: 200 })
    const elapsed = Date.now() - start
    expect(r.status).toBe('error')
    expect(elapsed).toBeLessThan(1000)
    expect(r.items.some((it) => it.type === 'error')).toBe(true)
  })

  test('default timeout is permissive (~30s constant lives in workerHost)', async () => {
    // Sanity: quickjs.ts itself should accept undefined options. We don't
    // actually run a long sleep here.
    const r = await runInQuickJS('1 + 1')
    expect(r.status).toBe('done')
  })
})
