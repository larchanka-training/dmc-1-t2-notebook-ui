import { describe, expect, test } from 'vitest'
import { normalizeEol } from './eol.mjs'

describe('normalizeEol', () => {
  test('CRLF normalizes to LF', () => {
    expect(normalizeEol('a\r\nb\r\n')).toBe('a\nb\n')
  })

  test('CRLF and LF forms compare equal after normalizing', () => {
    expect(normalizeEol('a\r\nb')).toBe(normalizeEol('a\nb'))
  })

  test('LF-only text is unchanged', () => {
    expect(normalizeEol('a\nb\n')).toBe('a\nb\n')
  })

  test('a bare CR (not part of CRLF) is left untouched', () => {
    expect(normalizeEol('a\rb')).toBe('a\rb')
  })
})
