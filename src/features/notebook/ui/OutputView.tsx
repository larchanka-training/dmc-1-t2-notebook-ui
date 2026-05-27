// Renders a list of OutputItem produced by the runtime, PRESERVING the order
// in which user code emitted them. Each item type has its own style:
//   - stdout → plain mono text
//   - stderr → muted/colored (warn vs error indicated by the [prefix])
//   - result → monospace, dimmed, with `⟹` lead to mark "REPL value"
//   - error → red alert with name/message and optional stack
//   - html / image → sandboxed iframe / <img>
//
// Consecutive stdout/stderr items are merged into a single block (so a run of
// console.log lines reads as one log), but a result / error / html / image in
// between splits the stream — the on-screen order matches execution order.
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Card } from '@/shared/ui/card'
import { cn } from '@/shared/lib/cn'
import type { OutputItem, SerializedValue } from '../runtime/types'
import { OutputFrame } from './OutputFrame'

interface OutputViewProps {
  items: OutputItem[]
}

type StreamItem = Extract<OutputItem, { type: 'stdout' | 'stderr' }>

/** An ordered chunk: either a run of consecutive stream lines or one rich item. */
type Segment = { kind: 'stream'; items: StreamItem[] } | { kind: 'single'; item: OutputItem }

/**
 * Fold the flat item list into ordered segments, merging ONLY adjacent
 * stdout/stderr items. Anything else stays a standalone segment in place, so
 * rendering the segments in order reproduces the execution order.
 */
function toSegments(items: OutputItem[]): Segment[] {
  const segments: Segment[] = []
  for (const item of items) {
    if (item.type === 'stdout' || item.type === 'stderr') {
      const last = segments[segments.length - 1]
      if (last?.kind === 'stream') last.items.push(item)
      else segments.push({ kind: 'stream', items: [item] })
    } else {
      segments.push({ kind: 'single', item })
    }
  }
  return segments
}

export function OutputView({ items }: OutputViewProps) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {toSegments(items).map((seg, i) =>
        seg.kind === 'stream' ? (
          <StreamBlock key={i} items={seg.items} />
        ) : (
          <SingleItem key={i} item={seg.item} />
        ),
      )}
    </div>
  )
}

function StreamBlock({ items }: { items: StreamItem[] }) {
  return (
    <Card
      size="sm"
      className="gap-0 py-3 ring-0 border-0 bg-secondary font-mono text-sm whitespace-pre-wrap"
    >
      <div className="px-4 space-y-0.5">
        {items.map((it, i) => (
          <div
            key={i}
            className={cn(it.type === 'stdout' ? 'text-foreground' : 'text-destructive')}
          >
            {it.text}
          </div>
        ))}
      </div>
    </Card>
  )
}

function SingleItem({ item }: { item: OutputItem }) {
  switch (item.type) {
    case 'result':
      return (
        <Card
          size="sm"
          className="gap-0 py-3 ring-0 border-0 bg-muted/40 font-mono text-sm whitespace-pre-wrap"
        >
          <div className="px-4 text-muted-foreground">⟹ {formatValue(item.value)}</div>
        </Card>
      )
    case 'html':
      return <OutputFrame html={item.html} />
    case 'image':
      return (
        <img
          src={`data:${item.mime};base64,${item.data}`}
          alt="cell output"
          className="block max-w-full rounded border border-border"
        />
      )
    case 'error':
      return (
        <Alert variant="destructive" className="font-mono">
          <AlertDescription className="whitespace-pre-wrap">
            <span className="font-semibold">{item.name}</span>: {item.message}
            {item.stack ? `\n${item.stack}` : null}
          </AlertDescription>
        </Alert>
      )
    default:
      return null
  }
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
