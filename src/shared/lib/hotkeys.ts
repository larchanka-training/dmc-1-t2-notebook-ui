import { useEffect, useRef } from 'react'

// Lightweight notebook-wide keyboard shortcuts. A single document-level
// keydown listener dispatches to the TOP scope on a stack, so a modal (help,
// search) that pushes its own scope transparently captures keys and shields
// the layers beneath it. No external dependency — this is the `reatomHotkeys`
// equivalent the epic calls for.
//
// Reatom note: handlers that call atoms/actions must be wrapped with `wrap()`
// at the call site (e.g. in NotebookView), per the strict async-stack rule in
// `src/setup.ts`. This module only invokes the handler it is given.

export type HotkeyHandler = (event: KeyboardEvent) => void
export type HotkeyBindings = Record<string, HotkeyHandler>

export interface UseHotkeysOptions {
  enabled?: boolean
  // A modal scope (e.g. an open dialog) absorbs all keys: handlers below it on
  // the stack never fire, even for keys it doesn't bind. Non-modal scopes
  // coexist — a key not bound by the top scope falls through to the next.
  modal?: boolean
}

interface Scope {
  id: number
  modal: boolean
  getBindings: () => HotkeyBindings
}

const scopeStack: Scope[] = []
let nextScopeId = 0

/**
 * Normalise a keyboard event to a binding key, e.g. `Mod-z`, `Mod-Shift-z`,
 * `Shift-Enter`, `Alt-Enter`, `ArrowUp`, `a`, `?`. `Mod` is Cmd on macOS and
 * Ctrl elsewhere. Shift is encoded only for letters and named keys; for symbol
 * keys (`?`) the produced character already reflects Shift.
 */
export function eventToBindingKey(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')

  let key = event.key
  const isSingleChar = key.length === 1
  const isLetter = isSingleChar && /[a-z]/i.test(key)
  if (event.shiftKey && (!isSingleChar || isLetter)) parts.push('Shift')
  if (isLetter) key = key.toLowerCase()
  parts.push(key)
  return parts.join('-')
}

/** Is focus in a text-editing surface (input, textarea, CodeMirror, etc.)? */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.closest('.cm-editor') != null
}

function handleKeydown(event: KeyboardEvent): void {
  const bindingKey = eventToBindingKey(event)
  // Single-key / Shift / Alt shortcuts must not fire while the user is typing
  // in an editor — only modifier (Mod-*) combos are safe there. CodeMirror
  // already handles its own Enter/Esc variants internally.
  const isModCombo = event.metaKey || event.ctrlKey
  const blockedByEditor = !isModCombo && isEditableTarget(event.target)

  // Walk the stack top-down: the first scope that binds the key handles it.
  // A modal scope stops the walk even when it doesn't bind the key.
  for (let i = scopeStack.length - 1; i >= 0; i--) {
    const scope = scopeStack[i]
    const handler = scope.getBindings()[bindingKey]
    if (handler && !blockedByEditor) {
      event.preventDefault()
      handler(event)
      return
    }
    if (scope.modal) return
  }
}

function pushScope(scope: Scope): void {
  if (scopeStack.length === 0) {
    document.addEventListener('keydown', handleKeydown)
  }
  scopeStack.push(scope)
}

function popScope(id: number): void {
  const idx = scopeStack.findIndex((s) => s.id === id)
  if (idx !== -1) scopeStack.splice(idx, 1)
  if (scopeStack.length === 0) {
    document.removeEventListener('keydown', handleKeydown)
  }
}

/**
 * Register a set of keyboard shortcuts for as long as the component is mounted
 * and `enabled`. The latest `bindings` object is always used (read through a
 * ref), so callers can pass freshly-closed handlers each render.
 */
export function useHotkeys(
  bindings: HotkeyBindings,
  options: boolean | UseHotkeysOptions = {},
): void {
  const opts: UseHotkeysOptions = typeof options === 'boolean' ? { enabled: options } : options
  const { enabled = true, modal = false } = opts

  const bindingsRef = useRef(bindings)
  useEffect(() => {
    bindingsRef.current = bindings
  })

  useEffect(() => {
    if (!enabled) return
    const scope: Scope = { id: nextScopeId++, modal, getBindings: () => bindingsRef.current }
    pushScope(scope)
    return () => popScope(scope.id)
  }, [enabled, modal])
}
