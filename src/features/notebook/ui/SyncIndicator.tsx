import { reatomComponent } from '@reatom/react'
import { Check, CircleAlert, CloudOff, Loader2, LogIn } from 'lucide-react'
import { pausedAtom, remoteSyncStatusAtom } from '../model/remoteSync'

// Header remote-sync status (#135), shown next to the local SaveIndicator. Pure
// read of the engine's coarse status (#134) + the session-expired pause flag.
//
// `paused` is checked FIRST: it means a token refresh already failed and a real
// re-login is needed, which the user must act on — distinct from a transient
// 'error'. We never promise an untrusted-device data wipe here; that policy is
// #136. The local-vs-server distinction is intentional: SaveIndicator owns "saved
// on this device", this owns "synced to the server".
export const SyncIndicator = reatomComponent(() => {
  const paused = pausedAtom()
  const status = remoteSyncStatusAtom()

  if (paused) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <LogIn className="size-3.5" />
        Sign in again to sync
      </span>
    )
  }

  if (status === 'syncing') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Syncing…
      </span>
    )
  }

  if (status === 'offline') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CloudOff className="size-3.5" />
        Offline — will sync when back online
      </span>
    )
  }

  // Distinguish transient from terminal (CL-13): 'error' has a retry armed, so it
  // reads as a soft "retrying" hint (muted), while 'failed' is terminal — no
  // auto-retry — and reads as a hard error (destructive). Collapsing them hid
  // "stuck" behind "will recover".
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CircleAlert className="size-3.5" />
        Sync issue — retrying…
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <CircleAlert className="size-3.5" />
        Sync failed
      </span>
    )
  }

  if (status === 'synced') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-success">
        <Check className="size-3.5" />
        Synced
      </span>
    )
  }

  // 'idle' / 'paused' handled above — nothing to report when idle (signed out or
  // no push has happened yet); the local SaveIndicator covers on-device state.
  return null
}, 'SyncIndicator')
