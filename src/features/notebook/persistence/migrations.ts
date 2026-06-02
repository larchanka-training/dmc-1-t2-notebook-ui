// Forward migrations for the persistent notebook format.
//
// Stored notebooks carry a `formatVersion`. On read we step a raw object from
// its stored version up to FORMAT_VERSION, one migration at a time. This is the
// pattern, established now while only v1 exists, so a future breaking change
// (new field, renamed field) ships a migration step instead of silently
// corrupting older saved notebooks.
//
// `migrations[n]` upgrades a document FROM version `n` to version `n + 1`.
// v0 is synthetic — it stands for "pre-versioning" objects that have no
// `formatVersion` field — and seeds the chain so the mechanism is exercised
// and tested before we actually need it.

import { assertNotebookJSON, FORMAT_VERSION, type NotebookJSON } from './schema'

/** The stored notebook was created by a newer app version than this build understands. */
export class NewerFormatError extends Error {
  readonly storedVersion: number
  readonly supportedVersion: number

  constructor(storedVersion: number, supportedVersion: number) {
    super(
      `Notebook was created in a newer format version (${storedVersion} > ${supportedVersion}). ` +
        'Update the application to open it.',
    )
    this.name = 'NewerFormatError'
    this.storedVersion = storedVersion
    this.supportedVersion = supportedVersion
  }
}

type Migration = (json: Record<string, unknown>) => Record<string, unknown>

/**
 * v0 → v1: a pre-versioning object has no `formatVersion` and may still use
 * the legacy cell field `code`. Stamp the version and rename `code → content`.
 */
function v0ToV1(json: Record<string, unknown>): Record<string, unknown> {
  const cells = Array.isArray(json['cells']) ? json['cells'] : []
  return {
    ...json,
    formatVersion: 1,
    cells: cells.map((cell) => {
      if (typeof cell !== 'object' || cell === null) return cell
      const record = cell as Record<string, unknown>
      if (!('content' in record) && 'code' in record) {
        const { code, ...rest } = record
        return { ...rest, content: code }
      }
      return record
    }),
  }
}

export const migrations: Record<number, Migration> = {
  0: v0ToV1,
}

function readVersion(json: Record<string, unknown>): number {
  const version = json['formatVersion']
  // Pre-versioning documents have no `formatVersion` — treat them as v0.
  return typeof version === 'number' ? version : 0
}

/**
 * Migrate a raw stored object up to the current format version and validate
 * the result. Throws if the document was created by a newer client (its
 * version exceeds the one this build understands) or if the migrated shape
 * fails validation.
 */
export function applyMigrations(raw: unknown): NotebookJSON {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid notebook JSON: not an object')
  }

  let current = raw as Record<string, unknown>
  let version = readVersion(current)

  if (version > FORMAT_VERSION) {
    throw new NewerFormatError(version, FORMAT_VERSION)
  }

  while (version < FORMAT_VERSION) {
    const migrate = migrations[version]
    if (!migrate) {
      throw new Error(`No migration registered from format version ${version}`)
    }
    current = migrate(current)
    version += 1
  }

  assertNotebookJSON(current)
  return current
}
