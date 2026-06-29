// Produce a safe `<a download>` filename from a user-controlled notebook title.
//
// `<a download="...">` is forwarded verbatim by the browser into the OS save
// dialog, so unicode, slashes, and reserved characters reach the filesystem and
// cause inconsistent behaviour across Chrome / Safari / Firefox and across
// macOS / Windows. We resolve that at the boundary: ASCII allowlist, spaces
// collapsed to dashes, length capped. A blank or fully-stripped title falls
// back to `notebook-<id>` so the result is always a usable, predictable name.

const MAX_LEN = 80

export function sanitizeFilename(title: string, fallbackId: string): string {
  // Trailing `replace(/-+$/, '')` covers the edge case where `slice(0, MAX_LEN)`
  // chops exactly at a separator dash and leaves the name ending in `-`. The
  // earlier `replace(/-+/g, '-')` only collapses internal runs; only post-slice
  // can we tell that the final dash is one created by truncation, not by the
  // user.
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, MAX_LEN)
    .replace(/-+$/, '')
  return cleaned || `notebook-${fallbackId}`
}
