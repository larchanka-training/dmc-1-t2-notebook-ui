// Pure assembly of the notebook OpenAPI slice from the vendored backend spec.
//
// Kept side-effect-free (no fs, no process) so it is unit-testable:
// scripts/api-gen.mjs reads openapi/backend/openapi.json and feeds the parsed
// object here. See scripts/notebook-slice.test.mjs.

// Notebook endpoints are selected by URL prefix, not a literal list, so a new
// backend endpoint under /api/v1/notebooks is picked up without editing this
// file. STRIP_PREFIX is dropped from the emitted paths (the client targets it).
export const NOTEBOOK_PREFIX = '/api/v1/notebooks'
export const STRIP_PREFIX = '/api/v1'

// Invoke `onRef` with every `$ref` string under `node`, regardless of which
// component bucket it points at (handles arrays / nested objects).
function collectRefs(node, onRef) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, onRef)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') onRef(value)
      else collectRefs(value, onRef)
    }
  }
}

// Collect every `#/components/schemas/<name>` referenced anywhere under `node`
// (handles items / allOf / anyOf / oneOf / additionalProperties / nesting).
export function collectSchemaRefs(node, acc) {
  collectRefs(node, (ref) => {
    const match = /^#\/components\/schemas\/(.+)$/.exec(ref)
    if (match) acc.add(match[1])
  })
}

// Backend paths under the notebook resource, sorted for deterministic output.
// The trailing-slash boundary keeps siblings like `/api/v1/notebooks-archive`
// out.
export function notebookPaths(spec) {
  return Object.keys(spec.paths ?? {})
    .filter((p) => p === NOTEBOOK_PREFIX || p.startsWith(`${NOTEBOOK_PREFIX}/`))
    .sort()
}

// The slice inlines only components.schemas (+ securitySchemes). Fail loudly if
// the assembled doc still references a non-schema component (e.g. a shared
// response/parameter the backend factored out) or an unresolved schema, instead
// of silently emitting a dangling / `unknown` type.
function assertResolvableRefs(doc) {
  collectRefs(doc, (ref) => {
    const match = /^#\/components\/schemas\/(.+)$/.exec(ref)
    if (!match) {
      throw new Error(
        `[api-gen] notebook slice references a non-schema component: ${ref}. ` +
          `The slice inlines only components.schemas — inline it in the backend ` +
          `or extend scripts/notebook-slice.mjs.`,
      )
    }
    if (!doc.components.schemas[match[1]]) {
      throw new Error(`[api-gen] notebook slice has an unresolved schema $ref: ${ref}`)
    }
  })
}

// Build a minimal, self-contained OpenAPI doc covering only the notebook paths,
// with the `/api/v1` prefix stripped and the reachable schemas inlined.
export function assembleNotebookSpec(spec) {
  const matched = notebookPaths(spec)
  if (matched.length === 0) {
    throw new Error(`[api-gen] backend spec has no ${NOTEBOOK_PREFIX} paths`)
  }

  const paths = {}
  for (const path of matched) {
    // Slice + drop the operation docstrings, but keep the (required) response
    // descriptions so the doc stays valid OpenAPI.
    const sliced = structuredClone(spec.paths[path])
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

  // Emit alphabetically (deterministic across machines) and drop only each
  // schema's own top-level `description` annotation. Never recurse into
  // `properties`, so a field literally named `description` is preserved.
  const schemas = {}
  for (const name of [...wanted].sort()) {
    if (!allSchemas[name]) continue
    const schema = { ...allSchemas[name] }
    delete schema.description
    schemas[name] = schema
  }

  const doc = {
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

  assertResolvableRefs(doc)
  return doc
}
