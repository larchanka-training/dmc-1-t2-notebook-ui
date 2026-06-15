import { useEffect, useRef } from 'react'
import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import { Bot } from 'lucide-react'
import { cellsAtom, notebookTitleAtom, setNotebookTitle } from '../model/notebook'
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

  // The title atom is written ONLY here, on commit (blur / Enter), never per
  // keystroke. Typing just mutates the contenteditable DOM; we read it back on
  // commit and route the change through setNotebookTitle, which bumps the
  // revision so autosave picks up a title-only edit. (A previous live-sync wrote
  // the atom on every keystroke, which made setNotebookTitle's equality guard
  // see no change at commit time and skip the bump — so a title-only edit was
  // never persisted. See NotebookHeader.test.tsx regression.)
  const commit = wrap(() => {
    const next = ref.current?.textContent?.trim() ?? ''
    // Empty title falls back to the placeholder text, mirrored into the model.
    setNotebookTitle(next || PLACEHOLDER)
    if (ref.current && !next) ref.current.textContent = PLACEHOLDER
    committedRef.current = notebookTitleAtom()
  })

  // Escape restores the title shown when editing began. The atom is untouched
  // while typing, so there is nothing reactive to roll back — resetting the DOM
  // text is enough; the follow-up blur re-commits it as a no-op.
  const cancel = wrap(() => {
    if (ref.current) ref.current.textContent = committedRef.current
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
