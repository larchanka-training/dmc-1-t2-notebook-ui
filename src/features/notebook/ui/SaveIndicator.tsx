import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Check, CircleAlert, Loader2 } from 'lucide-react'
import {
  lastSavedAtAtom,
  reloadFromStorage,
  saveMine,
  saveNow,
  saveStatusAtom,
} from '../model/autosave'

// "just now" while the save is fresh (a couple of minutes), then a clock time —
// mirrors new-design-v2's sync indicator.
const JUST_NOW_MS = 2 * 60 * 1000

function formatSavedAt(ms: number): string {
  if (Date.now() - ms < JUST_NOW_MS) return 'just now'
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Header autosave status. Mirrors the save state machine from the model:
// saving, saved, error, cross-tab conflict, and "this app is too old for the
// stored notebook format". Pure read from the model — no local state.
export const SaveIndicator = reatomComponent(() => {
  const status = saveStatusAtom()
  const lastSavedAt = lastSavedAtAtom()

  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving…
      </span>
    )
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={wrap(() => void saveNow())}
        className="flex items-center gap-1.5 text-sm text-destructive hover:underline"
      >
        <CircleAlert className="size-3.5" />
        Save failed — retry
      </button>
    )
  }

  if (status === 'conflict') {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-sm text-destructive">
        <CircleAlert className="size-3.5" />
        Changed in another tab
        <button type="button" onClick={wrap(() => void reloadFromStorage())} className="underline">
          Reload
        </button>
        <span aria-hidden="true">/</span>
        <button type="button" onClick={wrap(() => void saveMine())} className="underline">
          Save mine
        </button>
      </span>
    )
  }

  if (status === 'outdated') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive">
        <CircleAlert className="size-3.5" />
        Saved in a newer app version — update to edit this notebook
      </span>
    )
  }

  if (status === 'saved' && lastSavedAt !== null) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-success">
        <Check className="size-3.5" />
        Saved · {formatSavedAt(lastSavedAt)}
      </span>
    )
  }

  // 'idle' before the first save — nothing to report yet.
  return null
}, 'SaveIndicator')
