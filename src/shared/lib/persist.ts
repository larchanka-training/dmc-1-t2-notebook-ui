// Reatom's `withLocalStorage` persists an atom as a JSON record `{ data, to }`,
// where `to` is an optional TTL expiry timestamp (ms since epoch). These helpers
// read that record WITHOUT going through a Reatom atom, so they work in any
// context — including a detached async continuation after `await fetch`, where
// the Reatom frame is off the stack and a cold-atom read would silently return
// its init value (`null`) instead of the persisted token.
//
// This is the crux of the refresh-token fix: the refresh flow must read the
// opaque refresh token straight from localStorage, not via the cold
// `refreshTokenAtom`. See `.agents/issues/TARDIS-74/login-flow-issue.md`.

interface PersistRecord<T> {
  data?: T | null
  to?: number
}

// Read a persisted atom value, honouring the Reatom TTL field (`to`): an expired
// entry is removed and treated as absent. Returns null when the key is missing,
// expired, or malformed.
export function readPersistRecord<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const rec = JSON.parse(raw) as PersistRecord<T>
    if (typeof rec.to === 'number' && rec.to < Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return rec.data ?? null
  } catch {
    return null
  }
}

// Parse a raw localStorage string (e.g. a `StorageEvent.newValue` from another
// tab) into the atom value. Unlike `readPersistRecord` it neither consults nor
// mutates localStorage and ignores the TTL — the event already carries the live
// value at the moment it was written.
export function parsePersistRecord<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return (JSON.parse(raw) as PersistRecord<T>).data ?? null
  } catch {
    return null
  }
}
