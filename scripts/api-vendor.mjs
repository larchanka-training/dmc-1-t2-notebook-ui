#!/usr/bin/env node
// Vendor the backend OpenAPI contract into this repo.
//
// Copies api/docs/openapi.json (the backend's source-of-truth schema) to
// openapi/backend/openapi.json as a byte-identical machine copy, and writes the
// do-not-edit marker if it is missing. `ui` must build on its own: its CI and
// pre-push hooks check out only `ui`, with no `../api`, so type generation reads
// the vendored copy rather than the live backend schema.
//
// Run this deliberately after the backend contract changes. It is NOT called by
// CI, `api:generate`, or `api:check`, and it requires the `../api` submodule.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const SRC = resolve('..', 'api', 'docs', 'openapi.json')
const DEST = join('openapi', 'backend', 'openapi.json')
const MARKER = join('openapi', 'backend', 'README.md')

const MARKER_TEXT = `# Vendored backend OpenAPI contract — DO NOT EDIT BY HAND

\`openapi.json\` in this folder is a machine copy of \`api/docs/openapi.json\` (the
backend's source-of-truth OpenAPI schema), produced by \`pnpm api:vendor\`.

## Why this exists

\`ui\` must build on its own. Its CI and pre-push hooks check out only \`ui\` — there
is no \`../api\` available — so type generation reads this vendored copy rather than
the live backend schema.

## How it is used

- \`pnpm api:generate\` slices the notebook paths out of this copy, strips the
  \`/api/v1\` prefix, and writes \`src/shared/api/generated/openapi-ts/notebook.d.ts\`.
- \`pnpm api:check\` regenerates from this copy and fails if the committed
  \`notebook.d.ts\` is stale.
- \`pnpm api:vendor\` refreshes this copy from \`../api/docs/openapi.json\`. It is
  **not** run by CI, \`api:generate\`, or \`api:check\`.

Do not edit \`openapi.json\` here by hand — re-run \`pnpm api:vendor\`. See
\`docs/architecture/api-layer.md\` for the full flow.
`

if (!existsSync(SRC)) {
  console.error(`[api:vendor] backend spec not found at ${SRC}`)
  console.error('[api:vendor] this script needs the ../api submodule checked out.')
  process.exit(1)
}

mkdirSync(dirname(DEST), { recursive: true })
copyFileSync(SRC, DEST)
if (!existsSync(MARKER)) writeFileSync(MARKER, MARKER_TEXT)

console.log(`[api:vendor] copied ${SRC} -> ${DEST}`)
