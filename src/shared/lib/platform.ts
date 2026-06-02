// Platform detection for keyboard-shortcut display. On macOS the modifier is
// the Command key (⌘); everywhere else it is Ctrl. We only use this for what
// the user SEES — the actual key handling uses `Mod` which CodeMirror / our
// hotkey layer already map per-platform.

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  // `userAgentData.platform` is the modern source; fall back to platform/UA.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export const isMac = detectMac()

/** Display label for the primary modifier: `⌘` on macOS, `Ctrl` elsewhere. */
export const modKeyLabel = isMac ? '⌘' : 'Ctrl'

/** Display label for Alt/Option: `⌥` on macOS, `Alt` elsewhere. */
export const altKeyLabel = isMac ? '⌥' : 'Alt'

/** Display label for Shift: `⇧` on macOS, `Shift` elsewhere. */
export const shiftKeyLabel = isMac ? '⇧' : 'Shift'
