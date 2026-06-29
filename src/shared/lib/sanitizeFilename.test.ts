import { describe, expect, test } from 'vitest'
import { sanitizeFilename } from './sanitizeFilename'

const ID = '11111111-1111-1111-1111-111111111111'

describe('sanitizeFilename', () => {
  test('keeps ASCII alphanumerics, replaces spaces with dashes', () => {
    expect(sanitizeFilename('My Notebook 01', ID)).toBe('My-Notebook-01')
  })

  test('falls back to notebook-<id> for an empty title', () => {
    expect(sanitizeFilename('', ID)).toBe(`notebook-${ID}`)
  })

  test('falls back when the title has only unicode that strips to nothing', () => {
    expect(sanitizeFilename('🚀🔥', ID)).toBe(`notebook-${ID}`)
  })

  test('strips cyrillic (ASCII-only allowlist) and falls back', () => {
    expect(sanitizeFilename('Заметка', ID)).toBe(`notebook-${ID}`)
  })

  test('drops path separators and reserved characters', () => {
    expect(sanitizeFilename('foo/bar:baz*?<>|"', ID)).toBe('foobarbaz')
  })

  test('collapses runs of whitespace and dashes into a single dash', () => {
    expect(sanitizeFilename('a   b---c', ID)).toBe('a-b-c')
  })

  test('caps length at 80 characters', () => {
    const long = 'a'.repeat(200)
    const out = sanitizeFilename(long, ID)
    expect(out.length).toBe(80)
  })

  test('trims leading/trailing whitespace before producing the name', () => {
    expect(sanitizeFilename('   hello   ', ID)).toBe('hello')
  })

  test('does not leave a trailing dash when slice cuts exactly at a separator', () => {
    // 79 chars + a space → after dash-join, char 80 is the dash itself; the
    // truncation would otherwise keep that dash at the end of the name.
    const title = 'a'.repeat(79) + ' x'
    const out = sanitizeFilename(title, ID)
    expect(out).toBe('a'.repeat(79))
    expect(out.endsWith('-')).toBe(false)
  })
})
