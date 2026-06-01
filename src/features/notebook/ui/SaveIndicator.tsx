import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Check, CircleAlert, Loader2 } from 'lucide-react'
import { lastSavedAtAtom, saveNow, saveStatusAtom } from '../model/autosave'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// Header autosave status. Mirrors the four states of `saveStatusAtom`; the
// error state offers a manual retry (autosave otherwise only fires on the next
// edit). Pure read from the model — no local state.
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

  if (status === 'saved' && lastSavedAt !== null) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Check className="size-3.5" />
        Saved · {formatTime(lastSavedAt)}
      </span>
    )
  }

  // 'idle' before the first save — nothing to report yet.
  return null
}, 'SaveIndicator')
