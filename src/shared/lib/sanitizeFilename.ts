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
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, MAX_LEN)
  return cleaned || `notebook-${fallbackId}`
}
