// Trigger a browser-native file download from an in-memory Blob.
//
// We create a temporary object URL, click a hidden `<a download>`, and then
// release the URL. Safari is the reason `revokeObjectURL` is deferred via
// setTimeout: revoking inside the same tick can cancel the download before the
// browser starts streaming bytes. Chrome and Firefox tolerate immediate revoke,
// but the deferred call is also safe there, so we keep one code path.

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
