import { describe, expect, test } from 'vitest'
import { splitThinkAndCode } from './reasoningParser'

describe('splitThinkAndCode', () => {
  test('returns plain code unchanged when there are no think tags', () => {
    const r = splitThinkAndCode('const a = 1;')
    expect(r).toEqual({ thinking: '', code: 'const a = 1;', thinkOpen: false })
  })

  test('separates a closed think block from the trailing code', () => {
    const r = splitThinkAndCode('<think>I will add two numbers</think>const a = 1 + 1;')
    expect(r.thinking).toBe('I will add two numbers')
    expect(r.code).toBe('const a = 1 + 1;')
    expect(r.thinkOpen).toBe(false)
  })

  test('flags an unclosed think block as still thinking with no code', () => {
    const r = splitThinkAndCode('<think>Hmm, structure, labels, positioned, labels…')
    expect(r.code).toBe('')
    expect(r.thinkOpen).toBe(true)
    expect(r.thinking).toContain('structure')
  })

  test('uses the LAST closing tag when the model repeats think blocks', () => {
    const raw = '<think>first</think><think>second</think>const x = 42;'
    const r = splitThinkAndCode(raw)
    expect(r.code).toBe('const x = 42;')
    expect(r.thinkOpen).toBe(false)
    // Inner repeated tags must not leak into the displayed thinking.
    expect(r.thinking).not.toContain('<think>')
    expect(r.thinking).not.toContain('</think>')
    expect(r.thinking).toContain('first')
    expect(r.thinking).toContain('second')
  })

  test('strips markdown fences the model wraps around the code', () => {
    const r = splitThinkAndCode('<think>ok</think>```js\nconst a = 1;\n```')
    expect(r.code).toBe('const a = 1;')
  })

  test('strips fences even without a think block', () => {
    expect(splitThinkAndCode('```typescript\nconst a = 1;\n```').code).toBe('const a = 1;')
  })

  test('treats a closed but empty answer as no code', () => {
    const r = splitThinkAndCode('<think>reasoned a lot</think>   \n  ')
    expect(r.code).toBe('')
    expect(r.thinkOpen).toBe(false)
    expect(r.thinking).toBe('reasoned a lot')
  })
})
