import { describe, expect, test } from 'vitest'
import { MAX_DEPTH, serialize } from './serialize'

describe('serialize — primitives', () => {
  test('string', () => {
    expect(serialize('hi')).toEqual({ kind: 'primitive', value: 'hi' })
  })

  test('number — finite', () => {
    expect(serialize(42)).toEqual({ kind: 'primitive', value: 42 })
  })

  test('number — NaN and Infinity stringified', () => {
    expect(serialize(NaN)).toEqual({ kind: 'primitive', value: 'NaN' })
    expect(serialize(Infinity)).toEqual({ kind: 'primitive', value: 'Infinity' })
  })

  test('boolean', () => {
    expect(serialize(true)).toEqual({ kind: 'primitive', value: true })
  })

  test('null', () => {
    expect(serialize(null)).toEqual({ kind: 'primitive', value: null })
  })

  test('undefined', () => {
    expect(serialize(undefined)).toEqual({ kind: 'undefined' })
  })

  test('bigint stringified with n suffix', () => {
    expect(serialize(123n)).toEqual({ kind: 'primitive', value: '123n' })
  })

  test('function — keeps name', () => {
    function myFn() {}
    expect(serialize(myFn)).toEqual({ kind: 'function', name: 'myFn' })
  })

  test('function — anonymous fallback', () => {
    expect(serialize(() => {})).toEqual({ kind: 'function', name: 'anonymous' })
  })

  test('symbol — function-shaped placeholder', () => {
    expect(serialize(Symbol('s'))).toEqual({ kind: 'function', name: 'Symbol(s)' })
  })
})

describe('serialize — arrays and objects', () => {
  test('flat array', () => {
    expect(serialize([1, 'a', true])).toEqual({
      kind: 'array',
      items: [
        { kind: 'primitive', value: 1 },
        { kind: 'primitive', value: 'a' },
        { kind: 'primitive', value: true },
      ],
    })
  })

  test('plain object', () => {
    expect(serialize({ a: 1, b: 'x' })).toEqual({
      kind: 'object',
      entries: [
        ['a', { kind: 'primitive', value: 1 }],
        ['b', { kind: 'primitive', value: 'x' }],
      ],
    })
  })

  test(`object at depth ${MAX_DEPTH} is preserved, depth ${MAX_DEPTH + 1} becomes [Object]`, () => {
    // Build a chain { a: { a: { a: { a: { a: { leaf: true } } } } } } —
    // 6 nested levels deep, leaf is at level 6.
    let inner: unknown = { leaf: true }
    for (let i = 0; i < MAX_DEPTH; i++) inner = { a: inner }
    const result = serialize(inner)

    // Walk down five levels; expect the leaf object to be truncated.
    let node = result
    for (let i = 0; i < MAX_DEPTH; i++) {
      expect(node.kind).toBe('object')
      if (node.kind !== 'object') return
      const next = node.entries.find(([k]) => k === 'a')?.[1]
      expect(next).toBeDefined()
      node = next!
    }
    expect(node).toEqual({ kind: 'truncated', placeholder: '[Object]' })
  })

  test('cyclic reference does not throw', () => {
    type Node = { self?: Node }
    const a: Node = {}
    a.self = a
    const result = serialize(a)
    expect(result.kind).toBe('object')
    if (result.kind !== 'object') return
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0][0]).toBe('self')
    expect(result.entries[0][1]).toEqual({ kind: 'truncated', placeholder: '[Object]' })
  })

  test('Date stringified to ISO', () => {
    const d = new Date('2024-01-15T10:00:00Z')
    expect(serialize(d)).toEqual({ kind: 'primitive', value: '2024-01-15T10:00:00.000Z' })
  })

  test('RegExp stringified to source/flags form', () => {
    expect(serialize(/foo/gi)).toEqual({ kind: 'primitive', value: '/foo/gi' })
  })

  test('Error stringified to name: message', () => {
    expect(serialize(new TypeError('nope'))).toEqual({
      kind: 'primitive',
      value: 'TypeError: nope',
    })
  })
})
