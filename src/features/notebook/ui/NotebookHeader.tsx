import { useEffect, useRef } from 'react'
import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import { Bot } from 'lucide-react'
import {
  activeNotebookIdAtom,
  cellsAtom,
  notebookTitleAtom,
  setNotebookTitle,
} from '../model/notebook'
import { renameListItem } from '../model/notebookList'
import { loadedModelAtom } from '../model/codeGenerator'

const PLACEHOLDER = 'Untitled notebook'

// Editable notebook title + a breadcrumb describing the document. The title is
// a contenteditable element rather than an <input> so it reads as a heading and
// grows with its text. We deliberately do NOT bind textContent to the atom on
// every render: that would reset the caret to the start on each keystroke.
// Instead we seed the text from the atom and sync only when it changes from the
// outside (load/restore), comparing against the live DOM text first.
export const NotebookHeader = reatomComponent(() => {
  const title = notebookTitleAtom()
  const cellCount = cellsAtom().length
  const loadedModel = loadedModelAtom()
  const ref = useRef<HTMLHeadingElement>(null)
  // The title at the moment editing started, captured on focus, so Escape can
  // restore it. The atom is written only on commit, so nothing reactive changes
  // while typing — this ref is the sole record of the pre-edit value.
  const committedRef = useRef(title)

  // Push external title changes (boot load, restore, sidebar rename)
  // into the element without clobbering the caret during local typing.
  useEffect(() => {
    const el = ref.current
    if (el && el.textContent !== title) el.textContent = title
  }, [title])

  // TARDIS-167 (#2): live sync while typing. Every keystroke writes the raw title
  // into the model (`setNotebookTitle` bumps the revision so autosave persists it
  // to IndexedDB) AND patches the sidebar list row in place. The list is NOT
  // re-fetched from the backend on a rename — the title rides the normal autosave
  // → remote-sync PATCH; refetching is what made a renamed notebook show its OLD
  // title in the sidebar after switching away and back. Trimming + the empty
  // fallback are deferred to commit so they don't fight the caret mid-word.
  const onInput = wrap(() => {
    const raw = ref.current?.textContent ?? ''
    setNotebookTitle(raw)
    renameListItem(activeNotebookIdAtom(), raw)
  })

  // Commit on blur / Enter: normalise to a trimmed value (empty → placeholder) and
  // mirror that back into the DOM + the sidebar row.
  const commit = wrap(() => {
    const next = ref.current?.textContent?.trim() ?? ''
    const title = next || PLACEHOLDER
    setNotebookTitle(title)
    renameListItem(activeNotebookIdAtom(), title)
    if (ref.current && ref.current.textContent !== title) ref.current.textContent = title
    committedRef.current = title
  })

  // Escape restores the title shown when editing began. Live-sync wrote every
  // keystroke into the model + list, so the rollback must reset all three: the
  // DOM text, the model atom, and the sidebar row.
  const cancel = wrap(() => {
    if (ref.current) ref.current.textContent = committedRef.current
    setNotebookTitle(committedRef.current)
    renameListItem(activeNotebookIdAtom(), committedRef.current)
  })

  // Snapshot the pre-edit title on focus. This reads an atom from a React event
  // boundary, so it must be wrapped: production enables clearStack(), under which
  // a bare atom read in an unwrapped handler throws `missing async stack`.
  const beginEdit = wrap(() => {
    committedRef.current = notebookTitleAtom()
  })

  return (
    <header className="mb-7">
      <div className="mb-2.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-[5px] border border-border bg-muted px-[7px] py-0.5 font-mono text-[11px]">
          notebook.js
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {cellCount} {cellCount === 1 ? 'cell' : 'cells'}
        </span>
        <span aria-hidden="true">·</span>
        <span>JavaScript / TypeScript</span>
        {loadedModel && (
          <>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1 text-primary">
              <Bot className="size-3" />
              {loadedModel}
            </span>
          </>
        )}
      </div>

      <h1
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Notebook title"
        data-placeholder={PLACEHOLDER}
        spellCheck={false}
        onFocus={beginEdit}
        onInput={onInput}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            // Restore the pre-edit title, then drop focus (the follow-up blur
            // re-commits the restored title, which is a no-op).
            cancel()
            e.currentTarget.blur()
          }
        }}
        className="-mx-1.5 rounded-[var(--radius-item)] px-1.5 text-[32px] font-semibold leading-tight tracking-[-0.02em] outline-none transition-colors hover:bg-muted/60 focus:bg-muted/40 focus:ring-2 focus:ring-ring/40 empty:before:text-muted-foreground/60 empty:before:content-[attr(data-placeholder)]"
      />
    </header>
  )
}, 'NotebookHeader')
