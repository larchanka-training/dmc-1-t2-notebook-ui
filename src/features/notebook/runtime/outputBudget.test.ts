import { describe, expect, test } from 'vitest'
import { measureItemBytes, OUTPUT_BUDGET_BYTES } from './outputBudget'
import type { OutputItem } from './types'

describe('measureItemBytes', () => {
  test('stdout / stderr count UTF-8 bytes of the text', () => {
    expect(measureItemBytes({ type: 'stdout', text: 'abc' })).toBe(3)
    expect(measureItemBytes({ type: 'stderr', text: 'abc' })).toBe(3)
  })

  test('counts multibyte characters as their UTF-8 length, not UTF-16 units', () => {
    // '😀' is 1 JS string char (2 UTF-16 units) but 4 UTF-8 bytes; 'é' is 2.
    expect(measureItemBytes({ type: 'stdout', text: '😀' })).toBe(4)
    expect(measureItemBytes({ type: 'stdout', text: 'é' })).toBe(2)
  })

  test('error sums name + message + stack', () => {
    const item: OutputItem = { type: 'error', name: 'E', message: 'msg', stack: 'st' }
    expect(measureItemBytes(item)).toBe(1 + 3 + 2)
  })

  test('error tolerates a missing stack', () => {
    expect(measureItemBytes({ type: 'error', name: 'E', message: 'msg' })).toBe(1 + 3)
  })

  test('result measures the JSON size of the serialized value', () => {
    const item: OutputItem = { type: 'result', value: { kind: 'primitive', value: 42 } }
    expect(measureItemBytes(item)).toBe(JSON.stringify(item.value).length)
  })

  test('html counts the markup bytes', () => {
    expect(measureItemBytes({ type: 'html', html: '<b>x</b>' })).toBe(8)
  })

  test('image counts base64 data + mime bytes', () => {
    expect(measureItemBytes({ type: 'image', mime: 'image/png', data: 'AAAA' })).toBe(
      'image/png'.length + 'AAAA'.length,
    )
  })

  test('the budget is the documented 5 MiB', () => {
    expect(OUTPUT_BUDGET_BYTES).toBe(5 * 1024 * 1024)
  })
})
