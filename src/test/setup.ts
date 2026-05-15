import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { context } from '@reatom/core'

beforeEach(() => {
  context.reset()
})

afterEach(() => {
  cleanup()
})
