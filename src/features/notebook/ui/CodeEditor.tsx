import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import type { Theme } from '@/entities/theme'
import { editorThemeExtension } from './codemirror/theme'

// Marks transactions that originate from an external `value` push (not user
// typing), so the updateListener can skip echoing them back through onChange.
// Without this a controlled push would re-emit the value the parent already
// has — harmless for typing, but noise for undo/redo (S5) which pushes old
// values in.
const External = Annotation.define<boolean>()

// One notebook-search match inside this cell's document, as a character range.
// `active` marks the single match the search bar is currently navigated to, so
// it gets a stronger highlight than the rest.
export interface SearchHighlight {
  from: number
  to: number
  active: boolean
}

// Replace the whole set of search-match decorations in one shot. Sent from the
// React layer whenever the notebook-search results for this cell change.
const setSearchHighlights = StateEffect.define<SearchHighlight[]>()

// Holds the search-match decorations. They are remapped across edits so they
// track the text until the next explicit update, and rebuilt on each effect.
const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setSearchHighlights)) continue
      const builder = new RangeSetBuilder<Decoration>()
      // Ranges arrive in document order (search scans source left-to-right),
      // which RangeSetBuilder requires. Clamp defensively and skip empties.
      for (const m of effect.value) {
        if (m.from >= m.to) continue
        builder.add(
          m.from,
          m.to,
          Decoration.mark({
            class: m.active ? 'cm-searchMatch cm-searchMatch-active' : 'cm-searchMatch',
          }),
        )
      }
      deco = builder.finish()
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// Run-key callbacks. Kept in a ref so the keymap (frozen at mount) always calls
// the latest handlers. Each returns nothing; the keymap wrapper returns `true`
// to stop CodeMirror from falling through to the default keymap.
interface RunHandlers {
  run: () => void
  runAndAdvance: () => void
  runAndInsertBelow: () => void
  exitToCommand: () => void
}

export interface CodeEditorProps {
  value: string
  theme: Theme
  showLineNumbers?: boolean
  readOnly?: boolean
  /** When true, focus the editor (used when this cell becomes active in edit mode). */
  autoFocus?: boolean
  /** Notebook-search matches within this cell, highlighted in the gutter text. */
  searchMatches?: SearchHighlight[]
  onChange: (value: string) => void
  onFocus?: () => void
  onRun?: () => void
  onRunAndAdvance?: () => void
  onRunAndInsertBelow?: () => void
  onExitToCommand?: () => void
}

/**
 * Controlled CodeMirror 6 editor for code cells. External `value` is pushed in
 * via a range dispatch (cursor-preserving), and edits flow out through
 * `onChange`. The view is created once per mount; all live values (value,
 * theme, callbacks) are read through refs so the editor is never recreated on
 * re-render — which keeps cursor/focus stable and survives StrictMode.
 */
export function CodeEditor({
  value,
  theme,
  showLineNumbers = false,
  readOnly = false,
  autoFocus = false,
  searchMatches,
  onChange,
  onFocus,
  onRun,
  onRunAndAdvance,
  onRunAndInsertBelow,
  onExitToCommand,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const handlersRef = useRef<RunHandlers>({
    run: () => {},
    runAndAdvance: () => {},
    runAndInsertBelow: () => {},
    exitToCommand: () => {},
  })

  // Lazy useState gives a stable instance without reading a ref during render.
  const [themeComp] = useState(() => new Compartment())
  const [lineNumbersComp] = useState(() => new Compartment())
  const [readOnlyComp] = useState(() => new Compartment())

  // Keep the live refs current on every render (extensions captured them once).
  // Done in an effect, not during render, per react-hooks/refs.
  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
    onFocusRef.current = onFocus
    handlersRef.current = {
      run: () => onRun?.(),
      runAndAdvance: () => onRunAndAdvance?.(),
      runAndInsertBelow: () => onRunAndInsertBelow?.(),
      exitToCommand: () => onExitToCommand?.(),
    }
  })

  // Create the view once. value/theme/callbacks come from refs + compartments.
  useEffect(() => {
    const runKeymap = Prec.highest(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            handlersRef.current.run()
            return true
          },
        },
        {
          key: 'Shift-Enter',
          run: () => {
            handlersRef.current.runAndAdvance()
            return true
          },
        },
        {
          key: 'Alt-Enter',
          run: () => {
            handlersRef.current.runAndInsertBelow()
            return true
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            // Blur the editor FIRST: just flipping the mode atom leaves focus
            // in the contenteditable, so command-mode single-key shortcuts
            // (A/B/M/Y/…) would be swallowed as text and the user stays stuck
            // in edit. Blurring moves focus to <body> so the document-level
            // hotkeys take over.
            view.contentDOM.blur()
            handlersRef.current.exitToCommand()
            return true
          },
        },
      ]),
    )

    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          runKeymap,
          lineNumbersComp.of(showLineNumbers ? lineNumbers() : []),
          // No CodeMirror `history()` here on purpose: notebook-level history
          // (model/history.ts) is the single owner of Mod-Z / Mod-Shift-Z.
          // Edits already flow into it through onChange -> updateCellCode
          // (coalesced per cell). If CM kept its own history too, one Mod-Z
          // while editing would undo at BOTH layers, and the CM undo would
          // re-enter onChange and wipe the notebook redo branch.
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          // Syntax highlight style is theme-owned (themeComp below): light gets
          // defaultHighlightStyle, dark gets bespin. Keeping it here too would
          // leave BOTH highlighters active in dark — their classes combine and
          // default wins by CSS order (the #708/#00f bug). One at a time only.
          javascript({ typescript: true }),
          autocompletion(),
          searchHighlightField,
          keymap.of([...defaultKeymap, ...completionKeymap, indentWithTab]),
          themeComp.of(editorThemeExtension(theme)),
          readOnlyComp.of(EditorState.readOnly.of(readOnly)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.focusChanged && update.view.hasFocus) onFocusRef.current?.()
            if (!update.docChanged) return
            const isExternal = update.transactions.some((tr) => tr.annotation(External))
            if (isExternal) return
            onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push external value changes in without clobbering the cursor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: External.of(true),
    })
  }, [value])

  // Reconfigure theme / line numbers / readOnly at runtime via compartments.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeComp.reconfigure(editorThemeExtension(theme)) })
  }, [theme, themeComp])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineNumbersComp.reconfigure(showLineNumbers ? lineNumbers() : []),
    })
  }, [showLineNumbers, lineNumbersComp])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly, readOnlyComp])

  // Serialise the matches so the effect below only re-dispatches when the
  // actual ranges change, not on every parent re-render (new array identity).
  const matchesKey = useMemo(
    () => (searchMatches ?? []).map((m) => `${m.from}:${m.to}:${m.active ? 1 : 0}`).join(','),
    [searchMatches],
  )

  // Push notebook-search matches into the decoration field.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setSearchHighlights.of(searchMatches ?? []) })
    // matchesKey captures the meaningful content of searchMatches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchesKey])

  // Pull focus into the editor when the cell becomes active in edit mode
  // (e.g. Enter in command mode, or Shift+Enter advancing into this cell).
  useEffect(() => {
    if (!autoFocus) return
    const view = viewRef.current
    if (view && !view.hasFocus) view.focus()
  }, [autoFocus])

  return <div ref={hostRef} className="cm-host overflow-hidden" />
}
