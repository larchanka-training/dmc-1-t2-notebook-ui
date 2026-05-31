import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'
import type { Theme } from '@/entities/theme'

// Base CodeMirror theme that pins the editor to our design tokens (mono font,
// transparent background so the cell card shows through, no hard-coded
// colours). It is theme-agnostic and always applied; the light/dark *syntax*
// palette is layered on top by `editorThemeExtension`.
const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    fontSize: '0.875rem',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '1rem',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
})

// Resolve the editor extension for the current app theme. Dark gets the
// one-dark syntax palette; light relies on CodeMirror's default highlight
// style (wired in CodeEditor) and only needs the base token theme.
export function editorThemeExtension(theme: Theme): Extension {
  return theme === 'dark' ? [baseTheme, oneDark] : [baseTheme]
}
