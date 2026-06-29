// Static syntax-highlighted code block — non-interactive (no editor, no copy
// button). For interactive editing use `CodeEditor` (CodeMirror); for inline
// markdown-driven code use `MarkdownView`. This is the bare-minimum primitive
// for docs / examples / read-only snippets.
//
// Uses `highlight.js` core + the JavaScript grammar registered explicitly,
// emitting the same `.hljs-*` token classes that `markdown.css` already styles
// (the markdown cell renderer goes through `rehype-highlight`, which is also
// a highlight.js wrapper — so colours and tokens stay consistent across the
// app whether code is shown in a markdown cell or via this component).

import { useMemo } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import { cn } from '@/shared/lib/cn'
import './hljs.css'

// Register once at module load. highlight.js de-duplicates internally, so
// repeated calls are safe — but we still gate to keep cold-import behaviour
// deterministic across HMR.
let registered = false
function ensureLanguages(): void {
  if (registered) return
  hljs.registerLanguage('javascript', javascript)
  registered = true
}

export type HighlightedCodeLanguage = 'javascript'

interface HighlightedCodeProps {
  code: string
  language?: HighlightedCodeLanguage
  className?: string
}

export function HighlightedCode({
  code,
  language = 'javascript',
  className,
}: HighlightedCodeProps) {
  const html = useMemo(() => {
    ensureLanguages()
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  }, [code, language])

  return (
    <pre
      className={cn(
        'max-w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius-item)] bg-muted p-3 text-xs leading-relaxed',
        className,
      )}
    >
      <code
        className={`hljs language-${language} font-mono`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  )
}
