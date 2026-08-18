// Structural validation of a generated `.ipynb` against the OFFICIAL upstream
// nbformat v4.5 JSON Schema (roadmap Step 7d).
//
// The schema next to this file is vendored VERBATIM from jupyter/nbformat
// (`nbformat/v4/nbformat.v4.5.schema.json`) and is prettier-ignored so it stays
// byte-identical to upstream — it is an external contract, not our source. Using
// the real schema (rather than hand-rolled shape assertions) is the point: it
// catches the requirements we would otherwise forget, e.g. the 4.5 cell `id`, the
// `^[a-zA-Z0-9-_]+$` id pattern, `additionalProperties: false` on cells/outputs,
// and the exact `output_type` enum.
//
// Test-only: nothing in `src/features` imports this, and `ajv` is a devDependency.
// Round-tripping through a real Jupyter kernel stays out of scope (frontend-only
// decision, docs/specs/export-completion-contract.md §5).

import Ajv04 from 'ajv-draft-04'
import type { AnySchema, ValidateFunction } from 'ajv-draft-04'
// `?raw` (not a JSON import): keeps the vendored file an opaque artifact rather
// than a typed module, and works under the jsdom test environment, where
// `import.meta.url` is an http URL and so cannot be read from disk.
import schemaSource from './nbformat.v4.5.schema.json?raw'

// The upstream schema is draft-04, which Ajv 8 does not speak natively — hence
// `ajv-draft-04`. `strict: false` because upstream uses keyword combinations Ajv's
// strict mode rejects (its own `description` on non-schema levels, etc.); we are
// validating AGAINST the schema, not auditing the schema's style.
let cached: ValidateFunction | null = null

function validator(): ValidateFunction {
  if (cached) return cached
  // The vendored file is trusted upstream input, so a cast is honest here: parsing
  // yields `any`, and Ajv would reject anything that is not a schema anyway.
  const schema = JSON.parse(schemaSource) as AnySchema
  const ajv = new Ajv04({ strict: false, allErrors: true })
  cached = ajv.compile(schema)
  return cached
}

/**
 * Assert that the SERIALIZED export (the bytes a user downloads, not the in-memory
 * object) is a valid nbformat 4.5 document. Takes the file text so the check covers
 * JSON serialization too — an object that stringifies to something invalid (e.g. an
 * `undefined` property silently dropped) must not pass.
 *
 * Throws with the full Ajv error list, which names the exact failing instance path.
 */
export function assertValidIpynbFile(fileText: string): void {
  const validate = validator()
  const parsed: unknown = JSON.parse(fileText)
  if (!validate(parsed)) {
    const details = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('\n')
    throw new Error(`Generated .ipynb does not satisfy the nbformat 4.5 schema:\n${details}`)
  }
}
