// Renders a list of OutputItem produced by the runtime: stdout/stderr
// lines on top, then the optional `result` block, then any errors.
//
// Why not just .join('\n')? Each item has its own style and semantics:
//   - stdout → plain mono text
//   - stderr → muted/colored (warn vs error indicated by the [prefix])
//   - result → monospace, dimmed, with `⟹` lead to mark "REPL value"
//   - error → red alert with name/message and optional stack
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Card } from '@/shared/ui/card'
import { cn } from '@/shared/lib/cn'
import type { OutputItem, SerializedValue } from '../runtime/types'
import { OutputFrame } from './OutputFrame'

interface OutputViewProps {
  items: OutputItem[]
}

export function OutputView({ items }: OutputViewProps) {
  if (items.length === 0) return null

  const streamItems = items.filter((it) => it.type === 'stdout' || it.type === 'stderr')
  const resultItem = items.find((it) => it.type === 'result')
  const errorItems = items.filter((it) => it.type === 'error')
  const richItems = items.filter((it) => it.type === 'html' || it.type === 'image')

  return (
    <div className="flex flex-col gap-2">
      {streamItems.length > 0 && (
        <Card
          size="sm"
          className="gap-0 py-3 ring-0 border-0 bg-secondary font-mono text-sm whitespace-pre-wrap"
        >
          <div className="px-4 space-y-0.5">
            {streamItems.map((it, i) => (
              <div
                key={i}
                className={cn(it.type === 'stdout' ? 'text-foreground' : 'text-destructive')}
              >
                {it.type === 'stdout' || it.type === 'stderr' ? it.text : null}
              </div>
            ))}
          </div>
        </Card>
      )}

      {resultItem && resultItem.type === 'result' && (
        <Card
          size="sm"
          className="gap-0 py-3 ring-0 border-0 bg-muted/40 font-mono text-sm whitespace-pre-wrap"
        >
          <div className="px-4 text-muted-foreground">⟹ {formatValue(resultItem.value)}</div>
        </Card>
      )}

      {richItems.map((it, i) => {
        if (it.type === 'html') {
          return <OutputFrame key={`rich-${i}`} html={it.html} />
        }
        if (it.type === 'image') {
          return (
            <img
              key={`rich-${i}`}
              src={`data:${it.mime};base64,${it.data}`}
              alt="cell output"
              className="block max-w-full rounded border border-border"
            />
          )
        }
        return null
      })}

      {errorItems.map((err, i) =>
        err.type === 'error' ? (
          <Alert key={`err-${i}`} variant="destructive" className="font-mono">
            <AlertDescription className="whitespace-pre-wrap">
              <span className="font-semibold">{err.name}</span>: {err.message}
              {err.stack ? `\n${err.stack}` : null}
            </AlertDescription>
          </Alert>
        ) : null,
      )}
    </div>
  )
}

/**
 * Compact rendering of a SerializedValue for the `result` slot. We don't
 * try to be a full inspector — the heavy lifting is the structured data
 * itself; here we just stringify for display.
 */
function formatValue(value: SerializedValue): string {
  switch (value.kind) {
    case 'primitive':
      return typeof value.value === 'string' ? JSON.stringify(value.value) : String(value.value)
    case 'undefined':
      return 'undefined'
    case 'function':
      return `[Function: ${value.name}]`
    case 'truncated':
      return value.placeholder
    case 'array':
      return `[${value.items.map(formatValue).join(', ')}]`
    case 'object': {
      const entries = value.entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ')
      return `{ ${entries} }`
    }
  }
}
