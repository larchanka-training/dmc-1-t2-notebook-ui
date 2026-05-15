#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const OPENAPI_DIR = 'openapi'
const OUT_DIR = 'src/shared/api/generated/openapi-ts'
const SUFFIX = '.openapi.yaml'

const isCheck = process.argv.includes('--check')

const specs = readdirSync(OPENAPI_DIR)
  .filter((f) => f.endsWith(SUFFIX))
  .map((f) => ({ name: basename(f, SUFFIX), input: join(OPENAPI_DIR, f) }))

if (specs.length === 0) {
  console.error(`[api-gen] no *.openapi.yaml specs in ${OPENAPI_DIR}/`)
  process.exit(1)
}

function generate(input, output) {
  execFileSync('pnpm', ['exec', 'openapi-typescript', input, '-o', output], {
    stdio: 'inherit',
  })
}

if (isCheck) {
  const tmp = mkdtempSync(join(tmpdir(), 'api-gen-'))
  try {
    let drift = false
    for (const { name, input } of specs) {
      const tmpOut = join(tmp, `${name}.d.ts`)
      generate(input, tmpOut)
      const committedPath = join(OUT_DIR, `${name}.d.ts`)
      const committed = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : ''
      const fresh = readFileSync(tmpOut, 'utf8')
      if (committed !== fresh) {
        console.error(`[api:check] DRIFT in ${committedPath} (regenerated from ${input})`)
        drift = true
      }
    }
    if (drift) {
      console.error('Run `pnpm api:generate` and commit the result.')
      process.exit(1)
    }
    console.log('[api:check] generated client is in sync with openapi/*.openapi.yaml')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const { name, input } of specs) {
    generate(input, join(OUT_DIR, `${name}.d.ts`))
  }
  console.log(`[api:generate] wrote ${specs.length} client(s) to ${OUT_DIR}`)
}
