import { useRef } from 'react'
import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { activeNotebookIdAtom, setNotebookTitle } from '../model/notebook'
import { renameListItem } from '../model/notebookList'
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
      // Only the notebook open in the editor slot has a title-persistence path
      // today (its title lives in the in-memory store + autosave). Renaming a
      // different backend row is presentational until the notebook-management
      // epic adds an update endpoint, so gate on the active slot id (#135).
      if (target.id === activeNotebookIdAtom()) {
        setNotebookTitle(next)
        // TARDIS-167 (#2): patch the sidebar row in step — no list refetch.
        renameListItem(target.id, next)
      }
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
