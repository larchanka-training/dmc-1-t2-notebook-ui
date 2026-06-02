import { useEffect } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { ensureKatexStyles, hasMathDelimiter } from './katexStyles'
import './markdown.css'

// Renders a markdown cell's source as formatted HTML. Raw HTML embedded in the
// markdown is NOT rendered: we never enable `rehype-raw`, so any `<script>` or
// other tag in the source is shown as text, not executed. This is a deliberate
// XSS guard for shared notebooks (see Epic 03 acceptance criteria).
const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold mt-2 mb-3">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold mt-2 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-2">{children}</h3>,
  h4: ({ children }) => <h4 className="text-base font-semibold mt-2 mb-1">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  ),
  // Fenced blocks are wrapped by the `pre` renderer below; here we only style
  // inline code. Block `<code>` keeps the `hljs language-*` classes that
  // rehype-highlight adds, so the token colours from markdown.css apply.
  code: ({ className, children }) => {
    if (className?.includes('language-')) {
      return <code className={`${className} font-mono text-sm`}>{children}</code>
    }
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-3 py-1.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-1.5">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
}

export interface MarkdownViewProps {
  source: string
}

export function MarkdownView({ source }: MarkdownViewProps) {
  const hasMath = hasMathDelimiter(source)

  // Pull in KaTeX styles only once a cell actually uses math.
  useEffect(() => {
    if (hasMath) ensureKatexStyles()
  }, [hasMath])

  return (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeHighlight, rehypeKatex]}
    >
      {source}
    </ReactMarkdown>
  )
}
