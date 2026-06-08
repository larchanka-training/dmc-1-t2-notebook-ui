import { EditorView } from '@codemirror/view'
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import type { Theme } from '@/entities/theme'

// Bespin (base16 scheme by Jan T. Sott), ported from the CodeMirror 5 theme
// (codemirror.net/5/theme/bespin.css) to CM6 lezer tags. We take only the
// CODE token colours + the active-line tint, per the request — the editor
// background, default text, gutter and cursor keep our own design tokens.
const BESPIN = {
  keyword: '#cf6a4c', // .cm-keyword / .cm-tag
  string: '#f9ee98', // .cm-string
  comment: '#937121', // .cm-comment
  numberAtom: '#9b859d', // .cm-number / .cm-atom / .cm-link
  variable: '#54be0d', // .cm-variable / .cm-property / .cm-attribute
  def: '#cf7d34', // .cm-def
  variable2: '#5ea6ea', // .cm-variable-2
  activeLine: '#404040', // .CodeMirror-activeline-background
} as const

// Dark-only syntax palette. Light relies on CodeMirror's defaultHighlightStyle
// (wired in CodeEditor), so this maps bespin onto the lezer tags JS/TS produces.
const bespinHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.moduleKeyword], color: BESPIN.keyword },
  { tag: [t.tagName, t.angleBracket], color: BESPIN.keyword },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: BESPIN.string },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: BESPIN.comment },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null], color: BESPIN.numberAtom },
  { tag: [t.link, t.url], color: BESPIN.numberAtom },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: BESPIN.variable },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: BESPIN.def },
  {
    tag: [t.typeName, t.className, t.namespace, t.special(t.variableName)],
    color: BESPIN.variable2,
  },
  { tag: t.invalid, color: BESPIN.keyword },
])

// Active-line tint. Bespin uses #404040 over its own dark canvas; our editor is
// transparent over the (dark) cell card, so apply it semi-transparent so it
// reads as a subtle highlight regardless of the exact card colour.
const bespinActiveLineTheme = EditorView.theme(
  {
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in oklch, ' + BESPIN.activeLine + ' 55%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in oklch, ' + BESPIN.activeLine + ' 55%, transparent)',
    },
  },
  { dark: true },
)

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
  // Line-number gutter (shown only when line numbers are on): a hairline
  // divider on the right separates it from the editor, matching new-design-v2.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'color-mix(in oklch, var(--muted-foreground) 70%, transparent)',
    borderRight: '1px solid color-mix(in oklch, var(--border) 70%, transparent)',
  },
  // Even left/right breathing room for the line numbers. CodeMirror's default
  // gutter-element padding (0 3px 0 5px) crowds the numbers against the right
  // divider; new-design-v2 gives them symmetric padding.
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px',
  },
  // Active line: a neutral token-based tint (works in light; bespin overrides
  // it in dark via bespinActiveLineTheme). Driven by the highlightActiveLine()
  // extension wired in CodeEditor.
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklch, var(--muted-foreground) 9%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--muted-foreground) 9%, transparent)',
  },
  // Focused-editor outline. The real focus target is `.cm-content`
  // (contenteditable), so the browser paints its default `:focus-visible` ring
  // (the webkit `outline: auto` look) on it. Suppress that and draw a crisp 1px
  // ring in `currentColor` (= --foreground) around the CODE area only — i.e.
  // `.cm-content`, NOT `&` (`.cm-editor`, which also wraps the line-number
  // gutter). Inset box-shadow, not outline: it is never clipped by `.cm-host`'s
  // overflow and does not shift layout.
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-content': {
    outline: 'none',
    boxShadow: 'inset 0 0 0 1px currentColor',
    borderRadius: '6px',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  // Notebook-search matches. Every match gets a soft accent wash; the one the
  // search bar is navigated to gets a stronger ring so it stands out. Tokens
  // (not hard-coded colours) keep it correct in both light and dark.
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 22%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch-active': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 42%, transparent)',
    outline: '1px solid var(--primary)',
  },
})

// Resolve the editor extension for the current app theme. The syntax-highlight
// style is owned here (not statically in CodeEditor) so exactly ONE is active
// per theme: dark gets bespin (+ its active-line tint), light gets CodeMirror's
// defaultHighlightStyle. Layering both would let default override bespin by CSS
// order.
export function editorThemeExtension(theme: Theme): Extension {
  return theme === 'dark'
    ? [baseTheme, syntaxHighlighting(bespinHighlightStyle), bespinActiveLineTheme]
    : [baseTheme, syntaxHighlighting(defaultHighlightStyle)]
}
