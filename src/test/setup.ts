import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { context } from '@reatom/core'

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
