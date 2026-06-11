#!/usr/bin/env node
// Vendor the backend OpenAPI contract into this repo.
//
// Copies api/docs/openapi.json (the backend's source-of-truth schema) to
// openapi/backend/openapi.json as a machine copy (normalized to LF), and writes
// a do-not-edit marker if it is missing. `ui` must build on its own: its CI and
// pre-push hooks check out only `ui`, with no `../api`, so type generation reads
// the vendored copy rather than the live backend schema.
//
// Run this deliberately after the backend contract changes. It is NOT called by
// CI, `api:generate`, or `api:check`, and it requires the `../api` submodule.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeEol } from './eol.mjs'

// Minimal bootstrap marker, written only when openapi/backend/README.md is
// missing (e.g. a partial checkout). The committed README is the canonical,
// fuller doc — this stub deliberately does NOT duplicate its prose so the two
// cannot silently diverge.
export const MARKER_STUB = `# Vendored backend OpenAPI contract — DO NOT EDIT BY HAND

\`openapi.json\` here is a machine copy of \`api/docs/openapi.json\`, written by
\`pnpm api:vendor\`. Do not edit it by hand. See \`docs/architecture/api-layer.md\`.
`

// Copy the backend contract into the repo. Throws (rather than exiting) so it is
// unit-testable; the CLI wrapper maps the throw to a friendly exit. Re-running
// with an unchanged source produces an identical copy, and an existing marker is
// preserved — this is the AC#3 determinism guarantee.
export function vendor({ src, dest, marker, markerText = MARKER_STUB }) {
  if (!existsSync(src)) {
    throw new Error(`backend spec not found at ${src}; this needs the ../api submodule checked out`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  // Normalize to LF: the source may be CRLF on a Windows checkout, and the copy
  // must match the repo's LF .gitattributes so re-running stays git-clean.
  writeFileSync(dest, normalizeEol(readFileSync(src, 'utf8')))
  if (!existsSync(marker)) writeFileSync(marker, markerText)
}

// CLI entry — runs only when executed directly, not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const src = resolve('..', 'api', 'docs', 'openapi.json')
  const dest = join('openapi', 'backend', 'openapi.json')
  const marker = join('openapi', 'backend', 'README.md')
  try {
    vendor({ src, dest, marker })
    console.log(`[api:vendor] copied ${src} -> ${dest}`)
  } catch (err) {
    console.error(`[api:vendor] ${err.message}`)
    process.exit(1)
  }
}
