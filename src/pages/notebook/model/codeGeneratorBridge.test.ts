import { describe, expect, test } from 'vitest'
import { IN_BROWSER_SYSTEM_PROMPT } from './codeGeneratorBridge'

// TARDIS-168: the in-browser generator prompt must describe the real runtime so
// the model stops emitting code that cannot run in the QuickJS/Web Worker
// sandbox (DOM, fetch, timers, imports) and knows the only rich-output channel.
describe('IN_BROWSER_SYSTEM_PROMPT', () => {
  test('describes the QuickJS Web Worker sandbox', () => {
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('QuickJS')
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('Web Worker')
  })

  test('forbids the unavailable browser/Node capabilities', () => {
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('NO DOM')
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('fetch')
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('import/require/export')
  })

  test('documents the display() API with the allowed image MIME types', () => {
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain("display({ type: 'html'")
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain("display({ type: 'image'")
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']) {
      expect(IN_BROWSER_SYSTEM_PROMPT).toContain(mime)
    }
  })

  test('still demands raw code with no markdown fences', () => {
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('ONLY the JavaScript code')
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('no markdown code fences')
  })

  test('tells the model to degrade gracefully instead of faking missing APIs', () => {
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('HARD CONSTRAINTS')
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('ReferenceError')
    expect(IN_BROWSER_SYSTEM_PROMPT).toContain('DO NOT call or fake those APIs')
  })

  test('puts the hard constraints after the capabilities (trailing weight)', () => {
    expect(IN_BROWSER_SYSTEM_PROMPT.indexOf('HARD CONSTRAINTS')).toBeGreaterThan(
      IN_BROWSER_SYSTEM_PROMPT.indexOf('display({'),
    )
  })
})
