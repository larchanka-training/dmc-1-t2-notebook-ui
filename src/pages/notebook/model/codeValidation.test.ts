import { describe, expect, test } from 'vitest'
import { isParseableJs } from './codeValidation'

describe('isParseableJs', () => {
  test('accepts a complete statement', () => {
    expect(isParseableJs('const a = 1 + 1;')).toBe(true)
  })

  test('accepts top-level await (valid in a notebook cell)', () => {
    expect(isParseableJs('const x = await Promise.resolve(1);')).toBe(true)
  })

  test('accepts a bare trailing expression', () => {
    expect(isParseableJs('const a = 2;\na * 21')).toBe(true)
  })

  test('rejects an empty / whitespace-only string', () => {
    expect(isParseableJs('   \n  ')).toBe(false)
  })

  test('rejects code cut off mid-statement', () => {
    expect(isParseableJs('const a = function() { console.log(')).toBe(false)
  })

  test('rejects an unterminated string literal', () => {
    expect(isParseableJs('const s = "hello')).toBe(false)
  })
})
