#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { normalizeEol } from './eol.mjs'
import { assembleNotebookSpec } from './notebook-slice.mjs'

const OPENAPI_DIR = 'openapi'
const OUT_DIR = 'src/shared/api/generated/openapi-ts'
const SUFFIX = '.openapi.yaml'

// auth/llm are generated from hand-maintained YAML specs in openapi/. notebook
// is generated from the vendored backend contract instead — see
// openapi/backend/README.md and scripts/notebook-slice.mjs.
const BACKEND_SPEC = join(OPENAPI_DIR, 'backend', 'openapi.json')
const NOTEBOOK_NAME = 'notebook'

const isCheck = process.argv.includes('--check')

function generate(input, output) {
  execFileSync('pnpm', ['exec', 'openapi-typescript', input, '-o', output], {
    stdio: 'inherit',
  })
}

function readBackendSpec() {
  if (!existsSync(BACKEND_SPEC)) {
    console.error(`[api-gen] vendored backend spec not found at ${BACKEND_SPEC}`)
    console.error('[api-gen] run `pnpm api:vendor` to refresh it from ../api/docs/openapi.json.')
    process.exit(1)
  }
  return JSON.parse(readFileSync(BACKEND_SPEC, 'utf8'))
}

const yamlSpecs = readdirSync(OPENAPI_DIR)
  .filter((f) => f.endsWith(SUFFIX))
  .map((f) => ({ name: basename(f, SUFFIX), input: join(OPENAPI_DIR, f) }))

// Read (and validate) the vendored backend spec before creating the temp dir,
// so a missing copy exits cleanly with a helpful message and no leftover dir.
const backendSpec = readBackendSpec()

const work = mkdtempSync(join(tmpdir(), 'api-gen-'))
try {
  // The notebook slice is assembled on the fly into a temp spec, then consumed
  // like any YAML-backed spec. Generation never reads ../api — only the
  // committed vendored copy at openapi/backend/openapi.json.
  const notebookInput = join(work, `${NOTEBOOK_NAME}.openapi.json`)
  writeFileSync(notebookInput, JSON.stringify(assembleNotebookSpec(backendSpec), null, 2))
  const specs = [...yamlSpecs, { name: NOTEBOOK_NAME, input: notebookInput }]

  if (isCheck) {
    let drift = false
    for (const { name, input } of specs) {
      const tmpOut = join(work, `${name}.d.ts`)
      generate(input, tmpOut)
      const committedPath = join(OUT_DIR, `${name}.d.ts`)
      const committed = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : ''
      const committedNorm = normalizeEol(committed)
      const freshNorm = normalizeEol(readFileSync(tmpOut, 'utf8'))
      if (committedNorm !== freshNorm) {
        console.error(
          `[api:check] DRIFT in ${committedPath} ` +
            `(committed ${committedNorm.split('\n').length} lines, ` +
            `regenerated ${freshNorm.split('\n').length})`,
        )
        drift = true
      }
    }
    if (drift) {
      console.error('Run `pnpm api:generate`, then `git diff` to inspect, and commit the result.')
      process.exit(1)
    }
    console.log('[api:check] generated clients are in sync')
  } else {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const { name, input } of specs) {
      generate(input, join(OUT_DIR, `${name}.d.ts`))
    }
    console.log(`[api:generate] wrote ${specs.length} client(s) to ${OUT_DIR}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
