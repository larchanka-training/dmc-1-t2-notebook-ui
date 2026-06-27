import { describe, expect, test } from 'vitest'
import { isParseableJs, detectSandboxViolations } from './codeValidation'

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

describe('detectSandboxViolations', () => {
  test('returns nothing for clean sandbox code', () => {
    expect(detectSandboxViolations('const a = 1; console.log(a);')).toEqual([])
  })

  test('flags document.createElement in the cell', () => {
    expect(detectSandboxViolations("const c = document.createElement('canvas');")).toEqual([
      'createElement',
      'document',
    ])
  })

  test('flags createElementNS and getContext (the SVG/canvas confusion)', () => {
    const code =
      "const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');" +
      "const ctx = svg.getContext('2d');"
    expect(detectSandboxViolations(code)).toEqual(['createElementNS', 'document', 'getContext'])
  })

  test('flags fetch and timers', () => {
    expect(detectSandboxViolations('fetch("/x"); setTimeout(() => {}, 10);')).toEqual([
      'fetch',
      'setTimeout',
    ])
  })

  test('does NOT flag DOM tokens that live inside a display() html string', () => {
    // The correct pattern: canvas + drawing script INSIDE the html iframe. The
    // `document`/`getContext` here are characters in a string literal, not
    // identifier references, so the AST walk must ignore them.
    const code =
      'display({ type: "html", value: "<canvas id=\\"c\\"></canvas>' +
      "<script>document.getElementById('c').getContext('2d')</script>\" })"
    expect(detectSandboxViolations(code)).toEqual([])
  })

  test('does NOT flag an object key literally named document', () => {
    expect(detectSandboxViolations('const o = { document: 1 }; o.document;')).toEqual([])
  })

  test('returns nothing for unparseable code (handled by isParseableJs)', () => {
    expect(detectSandboxViolations('const a = document.createElement(')).toEqual([])
  })

  test('does NOT flag a user-declared local that shadows a forbidden global', () => {
    // A local `document`/`fetch` binding is sandbox-safe — it is not the host API.
    expect(
      detectSandboxViolations('const document = { id: 1 }; console.log(document.id);'),
    ).toEqual([])
    expect(detectSandboxViolations('function fetch(x) { return x; } fetch(1);')).toEqual([])
    expect(detectSandboxViolations('const f = (document) => document.x; f({ x: 1 });')).toEqual([])
  })

  test('still flags a real reference to the forbidden global', () => {
    // Sanity: shadow-skip must not blind the detector to genuine host use.
    expect(detectSandboxViolations('const el = document.body;')).toEqual(['document'])
  })
})
