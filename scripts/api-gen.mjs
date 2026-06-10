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

const OPENAPI_DIR = 'openapi'
const OUT_DIR = 'src/shared/api/generated/openapi-ts'
const SUFFIX = '.openapi.yaml'

// auth/llm are generated from hand-maintained YAML specs in openapi/. notebook
// is generated from the vendored backend contract instead: we slice out only the
// notebook paths, strip the `/api/v1` prefix (the client already targets that
// base) and keep the reachable schemas. See openapi/backend/README.md.
const BACKEND_SPEC = join(OPENAPI_DIR, 'backend', 'openapi.json')
const NOTEBOOK_NAME = 'notebook'
const NOTEBOOK_PATHS = ['/api/v1/notebooks', '/api/v1/notebooks/{notebook_id}']
const STRIP_PREFIX = '/api/v1'

const isCheck = process.argv.includes('--check')

// ---------------------------------------------------------------------------
// Notebook slice assembly
// ---------------------------------------------------------------------------

// Collect every `#/components/schemas/<name>` referenced anywhere under `node`.
function collectSchemaRefs(node, acc) {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaRefs(item, acc)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const match = /^#\/components\/schemas\/(.+)$/.exec(value)
        if (match) acc.add(match[1])
      } else {
        collectSchemaRefs(value, acc)
      }
    }
  }
}

// Drop `description` everywhere under `node`. Backend schemas carry long
// docstrings that openapi-typescript turns into noisy JSDoc without adding any
// type information. Safe for schemas (descriptions are never required there).
function stripDescriptions(node) {
  if (Array.isArray(node)) return node.map(stripDescriptions)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description') continue
      out[key] = stripDescriptions(value)
    }
    return out
  }
  return node
}

// Build a minimal, self-contained OpenAPI doc covering only the notebook paths,
// with the `/api/v1` prefix stripped and the reachable schemas inlined.
function assembleNotebookSpec() {
  const spec = JSON.parse(readFileSync(BACKEND_SPEC, 'utf8'))

  const paths = {}
  for (const path of NOTEBOOK_PATHS) {
    const item = spec.paths?.[path]
    if (!item) throw new Error(`[api-gen] backend spec is missing path ${path}`)
    // Slice + strip the operation docstrings, but keep the (required) response
    // descriptions so the doc stays valid OpenAPI.
    const sliced = structuredClone(item)
    delete sliced.description
    for (const key of Object.keys(sliced)) {
      const op = sliced[key]
      if (op && typeof op === 'object' && !Array.isArray(op)) delete op.description
    }
    paths[path.slice(STRIP_PREFIX.length)] = sliced
  }

  // Transitive closure of schemas reachable from the sliced paths.
  const allSchemas = spec.components?.schemas ?? {}
  const seed = new Set()
  collectSchemaRefs(paths, seed)
  const wanted = new Set()
  const stack = [...seed]
  while (stack.length > 0) {
    const name = stack.pop()
    if (wanted.has(name)) continue
    wanted.add(name)
    const refs = new Set()
    collectSchemaRefs(allSchemas[name], refs)
    for (const ref of refs) if (!wanted.has(ref)) stack.push(ref)
  }

  // Emit alphabetically so the generated d.ts is deterministic across machines.
  const schemas = {}
  for (const name of [...wanted].sort()) {
    if (allSchemas[name]) schemas[name] = stripDescriptions(allSchemas[name])
  }

  return {
    openapi: spec.openapi ?? '3.1.0',
    info: {
      title: 'Notebook API (vendored slice of api/docs/openapi.json)',
      version: spec.info?.version ?? '0.0.0',
    },
    paths,
    components: {
      schemas,
      ...(spec.components?.securitySchemes
        ? { securitySchemes: spec.components.securitySchemes }
        : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function generate(input, output) {
  execFileSync('pnpm', ['exec', 'openapi-typescript', input, '-o', output], {
    stdio: 'inherit',
  })
}

// Committed d.ts files are CRLF on Windows (core.autocrlf) while
// openapi-typescript always emits LF; compare EOL-insensitively so the drift
// check does not fire on line endings alone.
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n')
}

const yamlSpecs = readdirSync(OPENAPI_DIR)
  .filter((f) => f.endsWith(SUFFIX))
  .map((f) => ({ name: basename(f, SUFFIX), input: join(OPENAPI_DIR, f) }))

const work = mkdtempSync(join(tmpdir(), 'api-gen-'))
try {
  // The notebook slice is assembled on the fly into a temp spec, then consumed
  // like any YAML-backed spec. Generation never reads ../api — only the
  // committed vendored copy at openapi/backend/openapi.json.
  const notebookInput = join(work, `${NOTEBOOK_NAME}.openapi.json`)
  writeFileSync(notebookInput, JSON.stringify(assembleNotebookSpec(), null, 2))
  const specs = [...yamlSpecs, { name: NOTEBOOK_NAME, input: notebookInput }]

  if (specs.length === 0) {
    console.error(`[api-gen] no specs found in ${OPENAPI_DIR}/`)
    process.exit(1)
  }

  if (isCheck) {
    let drift = false
    for (const { name, input } of specs) {
      const tmpOut = join(work, `${name}.d.ts`)
      generate(input, tmpOut)
      const committedPath = join(OUT_DIR, `${name}.d.ts`)
      const committed = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : ''
      const fresh = readFileSync(tmpOut, 'utf8')
      if (normalizeEol(committed) !== normalizeEol(fresh)) {
        console.error(`[api:check] DRIFT in ${committedPath}`)
        drift = true
      }
    }
    if (drift) {
      console.error('Run `pnpm api:generate` and commit the result.')
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
