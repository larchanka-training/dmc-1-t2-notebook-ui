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
  // The title at the moment editing started, so Escape can roll back the
  // live-synced atom to what it was before this edit.
  const committedRef = useRef(title)

  // Push external title changes (boot load, restore, sidebar rename)
  // into the element without clobbering the caret during local typing.
  useEffect(() => {
    const el = ref.current
    if (el && el.textContent !== title) el.textContent = title
  }, [title])

  // Live-sync every keystroke into the title atom so the sidebar entry tracks
  // the edit in real time. This sets the atom directly (no revision bump) to
  // avoid spamming autosave on each key; the final commit below bumps once.
  const onInput = wrap(() => {
    notebookTitleAtom.set(ref.current?.textContent ?? '')
  })

  const commit = wrap(() => {
    const next = ref.current?.textContent?.trim() ?? ''
    // Empty title falls back to the placeholder text, mirrored into the model.
    setNotebookTitle(next || PLACEHOLDER)
    if (ref.current && !next) ref.current.textContent = PLACEHOLDER
    committedRef.current = notebookTitleAtom()
  })

  // Restore the pre-edit title (live-sync mutated the atom while typing).
  const cancel = wrap(() => {
    notebookTitleAtom.set(committedRef.current)
    if (ref.current) ref.current.textContent = committedRef.current
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
        onFocus={() => {
          committedRef.current = notebookTitleAtom()
        }}
        onInput={onInput}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            // Roll back the live-synced edit, then drop focus (blur re-commits
            // the now-restored title, which is a no-op).
            cancel()
            e.currentTarget.blur()
          }
        }}
        className="-mx-1.5 rounded-[var(--radius-item)] px-1.5 text-[32px] font-semibold leading-tight tracking-[-0.02em] outline-none transition-colors hover:bg-muted/60 focus:bg-muted/40 focus:ring-2 focus:ring-ring/40 empty:before:text-muted-foreground/60 empty:before:content-[attr(data-placeholder)]"
      />
    </header>
  )
}, 'NotebookHeader')
