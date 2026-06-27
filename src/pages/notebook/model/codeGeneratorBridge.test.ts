import { describe, expect, test, vi } from 'vitest'
import { IN_BROWSER_SYSTEM_PROMPT, buildGenerator } from './codeGeneratorBridge'

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

// A fake WebLLM engine whose stream models the real lock discipline: the engine
// holds a lock for the whole generation and releases it only when the stream is
// fully drained. If the generator abandons the stream early (e.g. `break`), the
// `finally` never runs, `released` stays false, and the NEXT run would deadlock.
function makeFakeEngine(chunks: string[]) {
  let interrupted = false
  const state = { released: false, interruptCalls: 0 }

  async function* streamGen() {
    try {
      for (const text of chunks) {
        // Once interrupted, the real engine stops emitting content and ends.
        if (interrupted) return
        yield { choices: [{ delta: { content: text } }] }
      }
    } finally {
      // Mirrors WebLLM's `lock.release()` at the end of asyncGenerate.
      state.released = true
    }
  }

  const engine = {
    chat: { completions: { create: vi.fn().mockResolvedValue(streamGen()) } },
    interruptGenerate: vi.fn().mockImplementation(async () => {
      interrupted = true
      state.interruptCalls += 1
    }),
  }
  return { engine, state }
}

describe('buildGenerator — stream draining (TARDIS-168)', () => {
  test('drains the stream to completion on a normal answer', async () => {
    const { engine, state } = makeFakeEngine(['<think>ok</think>', 'const a = 1;'])
    const result = await buildGenerator(engine as never)('do it')

    expect(result.code).toBe('const a = 1;')
    expect(result.incomplete).toBe(false)
    // The stream ran to its end → the engine lock was released.
    expect(state.released).toBe(true)
    expect(state.interruptCalls).toBe(0)
  })

  test('on a runaway reasoning loop, interrupts ONCE and still drains the stream', async () => {
    // A long unclosed <think> that blows the token budget: every chunk keeps the
    // think open, so the budget guard trips. The fix must NOT break out of the
    // loop — it must let the stream finish so the lock is released.
    const chunks = Array.from({ length: 4000 }, () => '<think>loop ')
    const { engine, state } = makeFakeEngine(chunks)

    const result = await buildGenerator(engine as never)('loop forever')

    expect(result.incomplete).toBe(true) // no usable code
    expect(state.interruptCalls).toBe(1) // interrupted exactly once, not per-chunk
    expect(state.released).toBe(true) // CRITICAL: lock released → next run won't deadlock
  })
})
