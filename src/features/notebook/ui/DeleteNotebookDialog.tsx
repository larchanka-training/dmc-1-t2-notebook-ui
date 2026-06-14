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
// row menu. Confirming runs `deleteNotebookAction` (optimistic row removal +
// server DELETE + local cleanup); the row rolls back on failure inside the action.
export const DeleteNotebookDialog = reatomComponent(() => {
  const target = deleteTargetAtom()

  const close = wrap(() => deleteTargetAtom.set(null))

  const confirm = wrap(() => {
    if (!target) return
    void deleteNotebookAction(target.id)
    deleteTargetAtom.set(null)
  })

  return (
    <Dialog
      open={target !== null}
      onOpenChange={wrap((open: boolean) => {
        if (!open) deleteTargetAtom.set(null)
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
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}, 'DeleteNotebookDialog')
