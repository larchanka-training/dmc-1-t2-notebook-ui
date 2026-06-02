// Stable client-side UUID generation.
//
// `crypto.randomUUID()` is only defined in a secure context — HTTPS, or the
// literal hosts `localhost` / `127.0.0.1`. The app also runs on INSECURE
// origins: the local dev domain `http://notebook.com` (root AGENTS.md §4) and
// bare-HTTP deploys by IP (§6). There `crypto.randomUUID` is `undefined`, and
// calling it unguarded throws — crashing whatever created the id (cell
// creation, notebook boot). So the call must be guarded.
//
// The id is a persisted/sync CONTRACT: `CellJSON.id` and the backend
// `CellSchema.id` are `format: uuid`. The fallback therefore still yields an
// RFC 4122 v4-shaped UUID, not a short random string. This matters because
// `notebook.com` is an insecure origin where dev sync (X-User-Id / DEV_USER,
// see api/docs/auth.md) DOES work — a non-UUID id there would break the very
// sync that a "good enough" string fallback was wrongly assumed unable to reach.

// Format 16 bytes as a v4 UUID (RFC 4122 §4.4: pin the version nibble to 4 and
// the variant bits to 10xx; the rest stays random).
function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 16; i += 1) {
    hex.push(bytes[i]!.toString(16).padStart(2, '0'))
  }
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/**
 * A random, RFC 4122 v4-shaped UUID.
 *
 * Prefers the native `crypto.randomUUID()`. On an insecure origin where that is
 * missing, builds an equivalent UUID from `crypto.getRandomValues`; as a last
 * resort (no Web Crypto at all — effectively unreachable in real browsers) from
 * `Math.random`. The result is always UUID-shaped, so the persisted/backend
 * `format: uuid` contract holds in every environment.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto.getRandomValues === 'function') {
      return uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)))
    }
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return uuidFromBytes(bytes)
}
