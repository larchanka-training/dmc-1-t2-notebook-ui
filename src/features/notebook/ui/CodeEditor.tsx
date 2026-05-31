import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { Annotation, Compartment, EditorState, Prec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
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
          run: () => {
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
          history(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          javascript({ typescript: true }),
          autocompletion(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
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

  // Pull focus into the editor when the cell becomes active in edit mode
  // (e.g. Enter in command mode, or Shift+Enter advancing into this cell).
  useEffect(() => {
    if (!autoFocus) return
    const view = viewRef.current
    if (view && !view.hasFocus) view.focus()
  }, [autoFocus])

  return <div ref={hostRef} className="cm-host overflow-hidden rounded-b-xl" />
}
