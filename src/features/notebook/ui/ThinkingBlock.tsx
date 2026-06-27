import { useEffect, useRef } from 'react'
import { reatomComponent } from '@reatom/react'
import { wrap } from '@reatom/core'
import { Brain, Loader2, Square, TriangleAlert } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'
import {
  thinkingSessionAtom,
  dismissThinkingAction,
  requestStopAction,
} from '../model/inBrowserThinking'

/**
 * Live "thinking" block for the In-browser reasoning models (TARDIS-168).
 *
 * Reasoning models (DeepSeek-R1-Distill) stream a `<think>…</think>` monologue
 * before the code. This block surfaces that stream in the notebook flow while
 * the model runs, then disappears once code is inserted. When the model never
 * produces runnable code (degenerate loop / empty), it switches to a `failed`
 * notice the user can dismiss.
 *
 * Rendering position is decided by the caller (NotebookView), which mounts this
 * only at the matching anchor; this component is purely presentational over the
 * single active session.
 */
export const ThinkingBlock = reatomComponent(() => {
  const session = thinkingSessionAtom()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the reasoning to the bottom as it streams, like a chat console.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session?.thinking])

  if (!session) return null
  const isFailed = session.phase === 'failed'

  return (
    <div
      className={cn(
        'rounded-[var(--radius-cell)] border bg-[color-mix(in_oklch,var(--muted)_36%,var(--card))] px-3 py-2.5 text-sm shadow-[var(--shadow-pop)]',
        isFailed ? 'border-destructive/40' : 'border-primary/30',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 font-medium">
        {isFailed ? (
          <>
            <TriangleAlert className="size-4 text-destructive" />
            <span className="text-destructive">The model couldn’t generate runnable code</span>
          </>
        ) : (
          <>
            <Brain className="size-4 text-primary" />
            <span className="text-primary">Thinking…</span>
            <Loader2 className="size-3.5 animate-spin text-primary/70" />
          </>
        )}
      </div>

      {session.thinking && (
        <div
          ref={scrollRef}
          className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-muted-foreground"
        >
          {session.thinking}
        </div>
      )}

      {/* Footer: Stop button (left) + token counter (right). The counter is
          secondary-coloured like a textarea's char limit; one stream chunk ==
          one generated token (TARDIS-168). */}
      {!isFailed && (
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            disabled={session.stopRequested}
            onClick={wrap(() => requestStopAction())}
          >
            <Square className="size-3 fill-current" />
            {session.stopRequested ? 'Stopping…' : 'Stop'}
          </Button>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {session.tokens} / {session.maxTokens} tokens
          </span>
        </div>
      )}

      {isFailed && (
        // A distinct destructive-tinted callout, set off from the grey reasoning
        // above so the recovery hint reads as guidance, not more model thinking.
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-[calc(var(--radius-cell)-4px)] border border-destructive/30 bg-destructive/10 px-2.5 py-2">
          <p className="text-[13px] font-medium text-foreground">
            Try rephrasing, simplifying the request, or switching to another model.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0"
            onClick={wrap(() => dismissThinkingAction())}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}, 'ThinkingBlock')
