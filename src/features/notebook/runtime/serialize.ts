// Safe serialization of arbitrary JS values into SerializedValue.
//
// Why this exists:
//   - postMessage's structured clone fails on functions, throws on cycles,
//     and silently truncates Date / RegExp / Map etc.
//   - JSON.stringify throws on cycles and on BigInt.
//   - We need a representation that the React UI can render predictably.
//
// Rules:
//   - Depth > MAX_DEPTH → { kind: 'truncated', placeholder: '[Object]' }.
//   - Cycle detected (object already on the path) → same truncated marker.
//   - Function → { kind: 'function', name }.
//   - undefined → { kind: 'undefined' }.
//   - null / boolean / number / string → primitive (number stringified for
//     non-finite values: 'NaN', 'Infinity').
//   - bigint → primitive (stringified, e.g. '42n').
//   - Symbol → function-shaped placeholder with description.
//   - Date, RegExp, Error → stringified to primitive.
//   - Array / plain object → recurse.

import type { SerializedValue } from './types'

export const MAX_DEPTH = 5

const TRUNCATED: SerializedValue = { kind: 'truncated', placeholder: '[Object]' }

export function serialize(value: unknown): SerializedValue {
  return walk(value, 0, new WeakSet())
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): SerializedValue {
  if (value === undefined) return { kind: 'undefined' }
  if (value === null) return { kind: 'primitive', value: null }

  const t = typeof value
  if (t === 'string') return { kind: 'primitive', value: value as string }
  if (t === 'boolean') return { kind: 'primitive', value: value as boolean }
  if (t === 'number') {
    const n = value as number
    if (Number.isFinite(n)) return { kind: 'primitive', value: n }
    return { kind: 'primitive', value: String(n) }
  }
  if (t === 'bigint') return { kind: 'primitive', value: `${value as bigint}n` }
  if (t === 'symbol') {
    const sym = value as symbol
    return { kind: 'function', name: `Symbol(${sym.description ?? ''})` }
  }
  if (t === 'function') {
    const fn = value as { name?: unknown }
    const name = typeof fn.name === 'string' && fn.name ? fn.name : 'anonymous'
    return { kind: 'function', name }
  }

  // Object branch (includes arrays, dates, regexps, errors, plain objects).
  const obj = value as object
  if (seen.has(obj)) return TRUNCATED
  if (depth >= MAX_DEPTH) return TRUNCATED
  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      return { kind: 'array', items: obj.map((item) => walk(item, depth + 1, seen)) }
    }
    if (obj instanceof Date) return { kind: 'primitive', value: obj.toISOString() }
    if (obj instanceof RegExp) return { kind: 'primitive', value: obj.toString() }
    if (obj instanceof Error) {
      return { kind: 'primitive', value: `${obj.name}: ${obj.message}` }
    }
    // Plain object — enumerate own enumerable string-keyed entries.
    const entries: Array<[string, SerializedValue]> = []
    for (const key of Object.keys(obj)) {
      entries.push([key, walk((obj as Record<string, unknown>)[key], depth + 1, seen)])
    }
    return { kind: 'object', entries }
  } finally {
    seen.delete(obj)
  }
}
