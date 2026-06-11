import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MARKER_STUB, vendor } from './api-vendor.mjs'

// Resolved from the package root (vitest runs with cwd = ui).
const SCRIPT = resolve('scripts', 'api-vendor.mjs')

let work
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'api-vendor-test-'))
})
afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('vendor', () => {
  test('normalizes the copy to LF and is idempotent (AC#3)', () => {
    const src = join(work, 'openapi.json')
    const dest = join(work, 'backend', 'openapi.json')
    const marker = join(work, 'backend', 'README.md')
    writeFileSync(src, '{"openapi":"3.1.0"}\r\n') // CRLF source (e.g. Windows checkout)

    vendor({ src, dest, marker })
    expect(readFileSync(dest, 'utf8')).toBe('{"openapi":"3.1.0"}\n') // → LF

    // Re-run with an unchanged source → byte-identical copy.
    const first = readFileSync(dest)
    vendor({ src, dest, marker })
    expect(readFileSync(dest).equals(first)).toBe(true)
  })

  test('writes the marker only when missing; preserves an existing one', () => {
    const src = join(work, 'openapi.json')
    const dest = join(work, 'backend', 'openapi.json')
    const marker = join(work, 'backend', 'README.md')
    writeFileSync(src, '{}')

    vendor({ src, dest, marker })
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toBe(MARKER_STUB)

    // A pre-existing (canonical) marker is preserved, not overwritten.
    writeFileSync(marker, '# canonical README\n')
    vendor({ src, dest, marker })
    expect(readFileSync(marker, 'utf8')).toBe('# canonical README\n')
  })

  test('throws when the source is missing (no ../api)', () => {
    expect(() =>
      vendor({
        src: join(work, 'nope.json'),
        dest: join(work, 'd.json'),
        marker: join(work, 'm.md'),
      }),
    ).toThrow(/not found/)
  })
})

// Exercises the CLI's cwd-relative default paths (../api/docs/openapi.json ->
// openapi/backend/openapi.json) by running the real script from a fake ui cwd.
describe('api:vendor CLI', () => {
  test('copies ../api/docs/openapi.json into openapi/backend from the ui cwd', () => {
    const ui = join(work, 'ui')
    mkdirSync(ui, { recursive: true })
    mkdirSync(join(work, 'api', 'docs'), { recursive: true })
    writeFileSync(join(work, 'api', 'docs', 'openapi.json'), '{"openapi":"3.1.0"}\r\n')

    execFileSync('node', [SCRIPT], { cwd: ui })

    expect(readFileSync(join(ui, 'openapi', 'backend', 'openapi.json'), 'utf8')).toBe(
      '{"openapi":"3.1.0"}\n', // copied + LF-normalized
    )
    expect(existsSync(join(ui, 'openapi', 'backend', 'README.md'))).toBe(true)
  })

  test('exits non-zero when ../api is absent', () => {
    const ui = join(work, 'ui')
    mkdirSync(ui, { recursive: true })
    expect(() => execFileSync('node', [SCRIPT], { cwd: ui, stdio: 'pipe' })).toThrow()
  })
})
