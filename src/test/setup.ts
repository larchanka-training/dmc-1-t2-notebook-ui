import '@testing-library/jest-dom/vitest'
// Provides a real in-memory IndexedDB implementation on the jsdom global, so
// the notebook persistence layer (idb) runs against a working store in tests.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { context } from '@reatom/core'

// JSDOM has no matchMedia; the theme layer uses reatomMediaQuery
// ('(prefers-color-scheme: dark)'), which calls it at import time. Stub a
// non-matching, listener-less media query so the theme resolves to 'light'.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

// CodeMirror 6 measures layout through Range geometry APIs that JSDOM does not
// implement. Without these stubs CM throws "getClientRects is not a function"
// from its requestAnimationFrame measure loop, crashing any test that mounts a
// code editor. The stubs return empty geometry — enough for CM to no-op its
// measuring in a headless environment.
const emptyRectList = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
} as unknown as DOMRectList

const emptyRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
} as DOMRect

Range.prototype.getClientRects = () => emptyRectList
Range.prototype.getBoundingClientRect = () => emptyRect
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}

beforeEach(() => {
  context.reset()
})

afterEach(() => {
  cleanup()
})
