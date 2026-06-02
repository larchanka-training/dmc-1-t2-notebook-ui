import { describe, expect, test } from 'vitest'
import { hasMathDelimiter } from './katexStyles'

describe('hasMathDelimiter', () => {
  test('detects inline math', () => {
    expect(hasMathDelimiter('Euler: $e^{i\\pi}+1=0$')).toBe(true)
    expect(hasMathDelimiter('a $x$ b')).toBe(true)
  })

  test('detects block math', () => {
    expect(hasMathDelimiter('$$\\int_0^1 x\\,dx$$')).toBe(true)
  })

  test('ignores a lone currency amount (regression: TARDIS-71 review #2)', () => {
    expect(hasMathDelimiter('costs $5')).toBe(false)
  })

  test('ignores two separate currency amounts', () => {
    // No space-free `$…$` span: each `$` is followed by a digit but the
    // closing `$` is preceded by a space, so this is prose, not math.
    expect(hasMathDelimiter('costs $5 and $10')).toBe(false)
  })

  test('ignores text without any dollar sign', () => {
    expect(hasMathDelimiter('# Title\n\nplain text')).toBe(false)
  })
})
