import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { deleteTargetAtom } from '../model/notebookSettings'
import { deleteNotebookAction } from '../model/notebookList'

// Confirm-before-delete dialog driven by `deleteTargetAtom` (#135). Reuses the
// existing `dialog.tsx` primitive (no new alert-dialog dependency — §11). Mounted
// once globally alongside RenameNotebookDialog so it is reachable from the sidebar
// row menu.
//
// Async ownership (CL-18): confirm AWAITS `deleteNotebookAction`, keeps a pending
// state (destructive button disabled, dialog non-dismissable), closes ONLY on
// success, and renders a concise error on failure instead of dropping a rejected
// destructive action on the floor. This is exactly the surface a failed
// active-delete (CL-4) needs to report on.
export const DeleteNotebookDialog = reatomComponent(() => {
  const target = deleteTargetAtom()
  const pending = !deleteNotebookAction.ready()
  const error = deleteNotebookAction.error()?.message

  const close = wrap(() => {
    if (pending) return // don't dismiss while the destructive action is in flight
    deleteTargetAtom.set(null)
  })

  const confirm = wrap(async () => {
    if (!target) return
    try {
      // Inner `wrap` re-binds the Reatom frame across the await so the
      // `deleteTargetAtom.set(null)` continuation runs IN-FRAME under production
      // `clearStack()` (invariant: every awaited promise is `await wrap(...)`).
      // A bare `await` here drops the async stack and the set throws
      // `missing async stack` in the browser, leaving the dialog stuck open.
      await wrap(deleteNotebookAction(target.id))
      // Close only after the delete actually committed (server + cleanup).
      deleteTargetAtom.set(null)
    } catch {
      // Keep the dialog open; `deleteNotebookAction.error()` renders below. The
      // optimistic row was already rolled back inside the action (withTransaction).
    }
  })

  return (
    <Dialog
      open={target !== null}
      onOpenChange={wrap((open: boolean) => {
        if (!open && !pending) deleteTargetAtom.set(null)
      })}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete notebook</DialogTitle>
          <DialogDescription>
            {target
              ? `“${target.title}” will be deleted from the server and this device. This cannot be undone.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="px-1 text-xs text-destructive">
            Delete failed. Check your connection and try again.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}, 'DeleteNotebookDialog')
