import { describe, expect, test, vi } from 'vitest'
import { executeJS } from './executeJS'

describe('executeJS', () => {
  test('captures console.log output', async () => {
    const result = await executeJS('console.log("hello")')
    expect(result).toEqual({ output: 'hello', error: false })
  })

  test('joins multi-argument console.log with spaces', async () => {
    const result = await executeJS('console.log(1, 2, 3)')
    expect(result.output).toBe('1 2 3')
    expect(result.error).toBe(false)
  })

  test('captures console.warn and console.error with prefixes', async () => {
    const result = await executeJS('console.warn("w"); console.error("e"); console.log("l")')
    expect(result.output).toBe('[warn] w\n[error] e\nl')
  })

  test('returns trailing expression value when no log', async () => {
    const result = await executeJS('1 + 2')
    expect(result.output).toBe('')
    expect(result.error).toBe(false)
  })

  test('supports top-level await', async () => {
    const result = await executeJS('const v = await Promise.resolve(42); console.log(v)')
    expect(result.output).toBe('42')
    expect(result.error).toBe(false)
  })

  test('returns error: true on thrown error', async () => {
    const result = await executeJS('throw new Error("boom")')
    expect(result.error).toBe(true)
    expect(result.output).toContain('boom')
  })

  test('returns error: true on syntax error', async () => {
    const result = await executeJS('this is not js')
    expect(result.error).toBe(true)
    expect(result.output.length).toBeGreaterThan(0)
  })

  test('does not call the global console.log when user code logs', async () => {
    const spy = vi.spyOn(console, 'log')
    const result = await executeJS('console.log("inside")')
    expect(spy).not.toHaveBeenCalled()
    expect(result.output).toBe('inside')
    spy.mockRestore()
  })

  test('does not leak captured lines between runs', async () => {
    await executeJS('console.log("first")')
    const result = await executeJS('console.log("second")')
    expect(result.output).toBe('second')
  })
})
