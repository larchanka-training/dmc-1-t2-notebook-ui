import { useRef } from 'react'
import { Play, Trash2, ChevronUp, ChevronDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type CellStatus = 'idle' | 'running' | 'done' | 'error'

export interface NotebookCellProps {
  index: number
  code: string
  output?: string
  status?: CellStatus
  isFirst?: boolean
  isLast?: boolean
  readOnly?: boolean
  onCodeChange?: (code: string) => void
  onRun?: () => void
  onDelete?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

/**
 * A single interactive notebook cell with a dark code editor and output area.
 * Supports idle / running / done / error states.
 * Run with the play button or Cmd+Enter / Ctrl+Enter.
 */
export function NotebookCell({
  index,
  code,
  output = '',
  status = 'idle',
  isFirst = false,
  isLast = false,
  readOnly = false,
  onCodeChange,
  onRun,
  onDelete,
  onMoveUp,
  onMoveDown,
}: NotebookCellProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  return (
    <div className={cn(
      'group border rounded-lg overflow-hidden bg-card',
      status === 'error' && 'border-destructive',
    )}>
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b">
        {/* run button — left, prominent */}
        {onRun && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-green-500 hover:bg-green-500/10"
            disabled={status === 'running'}
            onClick={onRun}
          >
            {status === 'running'
              ? <Loader2 className="size-4 animate-spin" />
              : <Play className="size-4" />}
          </Button>
        )}

        <span className="text-xs text-muted-foreground font-mono">[{index}]</span>

        {/* secondary actions — always visible, right side */}
        <div className="flex items-center gap-1 ml-auto">
          {onMoveUp && (
            <Button size="icon" variant="ghost" className="size-8" onClick={onMoveUp} disabled={isFirst}>
              <ChevronUp className="size-4" />
            </Button>
          )}
          {onMoveDown && (
            <Button size="icon" variant="ghost" className="size-8" onClick={onMoveDown} disabled={isLast}>
              <ChevronDown className="size-4" />
            </Button>
          )}
          {onDelete && (
            <Button size="icon" variant="ghost" className="size-8 text-destructive hover:bg-destructive/10" onClick={onDelete}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* editor */}
      <textarea
        ref={textareaRef}
        value={code}
        readOnly={readOnly}
        spellCheck={false}
        rows={1}
        onChange={e => {
          onCodeChange?.(e.target.value)
          autoResize(e.target)
        }}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            onRun?.()
          }
        }}
        onInput={e => autoResize(e.currentTarget)}
        className="w-full resize-none bg-[#1e1e2e] text-[#cdd6f4] font-mono text-sm p-4 outline-none min-h-[60px] leading-relaxed"
      />

      {/* output */}
      {output && (
        <div className={cn(
          'border-t px-4 py-3 font-mono text-sm whitespace-pre-wrap',
          status === 'error'
            ? 'text-destructive bg-destructive/5'
            : 'text-foreground bg-background',
        )}>
          {output}
        </div>
      )}
    </div>
  )
}
