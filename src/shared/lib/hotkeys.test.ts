import { describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { eventToBindingKey, isEditableTarget, useHotkeys } from './hotkeys'

function press(init: KeyboardEventInit & { key: string }, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (target) target.dispatchEvent(event)
  else document.dispatchEvent(event)
  return event
}

describe('eventToBindingKey', () => {
  test('encodes Mod combos cross-platform', () => {
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))).toBe(
      'Mod-z',
    )
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))).toBe(
      'Mod-z',
    )
  })

  test('encodes Mod-Shift combos', () => {
    expect(
      eventToBindingKey(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true })),
    ).toBe('Mod-Shift-z')
  })

  test('encodes Shift for letters and named keys', () => {
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(
      'Shift-Enter',
    )
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: 'A', shiftKey: true }))).toBe(
      'Shift-a',
    )
  })

  test('does not double-encode Shift for symbol keys', () => {
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))).toBe('?')
  })

  test('passes through arrows and Alt combos', () => {
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: 'ArrowUp' }))).toBe('ArrowUp')
    expect(eventToBindingKey(new KeyboardEvent('keydown', { key: 'Enter', altKey: true }))).toBe(
      'Alt-Enter',
    )
  })

  test('does not throw on a synthetic event with no key (focus-trap dispatch)', () => {
    // A focus-management library (e.g. the dialog opened by `?`) can dispatch a
    // keydown with no `key`. The dispatcher must not crash on `key.length`.
    const event = new KeyboardEvent('keydown')
    Object.defineProperty(event, 'key', { value: undefined })
    expect(() => eventToBindingKey(event)).not.toThrow()
  })
})

describe('isEditableTarget', () => {
  test('detects inputs, textareas and CodeMirror', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const cm = document.createElement('div')
    cm.className = 'cm-editor'
    const inner = document.createElement('span')
    cm.appendChild(inner)
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(inner)).toBe(true)
  })

  test('plain elements are not editable', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('useHotkeys', () => {
  test('invokes the matching handler and prevents default', () => {
    const run = vi.fn()
    renderHook(() => useHotkeys({ 'Mod-Enter': run }))
    const event = press({ key: 'Enter', metaKey: true })
    expect(run).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  test('single-key shortcuts are ignored while typing in an editor', () => {
    const insert = vi.fn()
    renderHook(() => useHotkeys({ a: insert }))
    const input = document.createElement('input')
    document.body.appendChild(input)
    press({ key: 'a' }, input)
    expect(insert).not.toHaveBeenCalled()
    // but fires when focus is outside an editor
    press({ key: 'a' })
    expect(insert).toHaveBeenCalledOnce()
    input.remove()
  })

  test('Mod combos still fire inside an editor', () => {
    const save = vi.fn()
    renderHook(() => useHotkeys({ 'Mod-s': save }))
    const input = document.createElement('input')
    document.body.appendChild(input)
    press({ key: 's', metaKey: true }, input)
    expect(save).toHaveBeenCalledOnce()
    input.remove()
  })

  test('the top scope binding wins for the same key', () => {
    const base = vi.fn()
    const top = vi.fn()
    renderHook(() => useHotkeys({ Escape: base }))
    const { unmount } = renderHook(() => useHotkeys({ Escape: top }))
    press({ key: 'Escape' })
    expect(top).toHaveBeenCalledOnce()
    expect(base).not.toHaveBeenCalled()
    // once the top scope unmounts, the base scope handles it again
    unmount()
    press({ key: 'Escape' })
    expect(base).toHaveBeenCalledOnce()
  })

  test('a non-modal top scope lets unbound keys fall through', () => {
    const baseA = vi.fn()
    const topB = vi.fn()
    renderHook(() => useHotkeys({ 'Mod-a': baseA }))
    renderHook(() => useHotkeys({ 'Mod-b': topB }))
    // 'Mod-a' is not bound by the top scope -> falls through to the base
    press({ key: 'a', metaKey: true })
    expect(baseA).toHaveBeenCalledOnce()
  })

  test('a modal top scope absorbs keys it does not bind', () => {
    const baseA = vi.fn()
    const modalEsc = vi.fn()
    renderHook(() => useHotkeys({ 'Mod-a': baseA }))
    renderHook(() => useHotkeys({ Escape: modalEsc }, { modal: true }))
    // modal scope doesn't bind Mod-a, but blocks it from reaching the base
    press({ key: 'a', metaKey: true })
    expect(baseA).not.toHaveBeenCalled()
  })

  test('disabled hotkeys do not register', () => {
    const run = vi.fn()
    renderHook(() => useHotkeys({ 'Mod-Enter': run }, false))
    press({ key: 'Enter', metaKey: true })
    expect(run).not.toHaveBeenCalled()
  })
})
