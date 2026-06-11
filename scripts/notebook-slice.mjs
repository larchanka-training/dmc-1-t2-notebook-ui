// Pure assembly of the notebook OpenAPI slice from the vendored backend spec.
//
// Kept side-effect-free (no fs, no process) so it is unit-testable:
// scripts/api-gen.mjs reads openapi/backend/openapi.json and feeds the parsed
// object here. See scripts/notebook-slice.test.mjs.

export const NOTEBOOK_PATHS = ['/api/v1/notebooks', '/api/v1/notebooks/{notebook_id}']
export const STRIP_PREFIX = '/api/v1'

// Collect every `#/components/schemas/<name>` referenced anywhere under `node`
// (handles items / allOf / anyOf / oneOf / additionalProperties / nesting).
export function collectSchemaRefs(node, acc) {
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

// Build a minimal, self-contained OpenAPI doc covering only the notebook paths,
// with the `/api/v1` prefix stripped and the reachable schemas inlined.
export function assembleNotebookSpec(spec) {
  const paths = {}
  for (const path of NOTEBOOK_PATHS) {
    const item = spec.paths?.[path]
    if (!item) throw new Error(`[api-gen] backend spec is missing path ${path}`)
    // Slice + drop the operation docstrings, but keep the (required) response
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
