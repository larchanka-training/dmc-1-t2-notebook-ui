import { useRef } from 'react'
import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { LOCAL_NOTEBOOK_ID, setNotebookTitle } from '../model/notebook'
import { renameTargetAtom } from '../model/notebookSettings'

// Rename dialog driven by renameTargetAtom (new-design-v2). Works for ANY
// listed notebook, not just the open one — the title field is seeded from the
// target, independent of the editor. The input is uncontrolled (ref +
// defaultValue) so no per-keystroke state is needed. Mounted once globally
// (alongside ShortcutsHelp) so it is reachable from the sidebar.
export const RenameNotebookDialog = reatomComponent(() => {
  const target = renameTargetAtom()
  const inputRef = useRef<HTMLInputElement>(null)

  const close = wrap(() => renameTargetAtom.set(null))

  const save = wrap(() => {
    if (!target) return
    const next = inputRef.current?.value.trim()
    // Empty input keeps the existing title (matches the prototype's fallback).
    if (next) {
      // Only the open local notebook has a persistence path today; renaming a
      // backend row is presentational until the notebook-management epic adds
      // an update endpoint.
      if (target.id === LOCAL_NOTEBOOK_ID) setNotebookTitle(next)
    }
    renameTargetAtom.set(null)
  })

  return (
    <Dialog
      open={target !== null}
      onOpenChange={wrap((open: boolean) => {
        if (!open) renameTargetAtom.set(null)
      })}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename notebook</DialogTitle>
        </DialogHeader>
        {/* key re-seeds defaultValue when the target changes between opens. */}
        <Input
          key={target?.id ?? 'none'}
          ref={inputRef}
          autoFocus
          defaultValue={target?.title ?? ''}
          aria-label="Notebook name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}, 'RenameNotebookDialog')
