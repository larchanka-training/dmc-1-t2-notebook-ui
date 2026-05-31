import { useEffect, useRef } from 'react'
import {
  Play,
  Square,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Type,
  Eye,
  Pencil,
} from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import type { Theme } from '@/entities/theme'
import type { CellKind, CellStatus, CellViewMode } from '../domain/cell'
import type { OutputItem } from '../runtime/types'
import { CodeEditor } from './CodeEditor'
import { MarkdownView } from './MarkdownView'
import { OutputView } from './OutputView'

export interface NotebookCellProps {
  /** Execution counter shown as `[N]`; null means the cell has never run. */
  executionCount?: number | null
  kind?: CellKind
  code: string
  output?: OutputItem[]
  status?: CellStatus
  viewMode?: CellViewMode
  /** Drives the CodeMirror syntax palette; follows the global app theme. */
  theme?: Theme
  showLineNumbers?: boolean
  /** Focus the code editor (cell is active in edit mode). */
  autoFocus?: boolean
  isFirst?: boolean
  isLast?: boolean
  readOnly?: boolean
  onCodeChange?: (code: string) => void
  onViewModeChange?: (mode: CellViewMode) => void
  onFocus?: () => void
  onRun?: () => void
  /** Shift+Enter: run, then move to (or create) the next cell. */
  onRunAndAdvance?: () => void
  /** Alt+Enter: run, then insert a fresh code cell below. */
  onRunAndInsertBelow?: () => void
  /** Esc: leave the editor for command mode. */
  onExitToCommand?: () => void
  onStop?: () => void
  onDelete?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

export function NotebookCell({
  executionCount = null,
  kind = 'code',
  code,
  output = [],
  status = 'idle',
  viewMode = 'edit',
  theme = 'light',
  showLineNumbers = false,
  autoFocus = false,
  isFirst = false,
  isLast = false,
  readOnly = false,
  onCodeChange,
  onViewModeChange,
  onFocus,
  onRun,
  onRunAndAdvance,
  onRunAndInsertBelow,
  onExitToCommand,
  onStop,
  onDelete,
  onMoveUp,
  onMoveDown,
}: NotebookCellProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  const isCode = kind === 'code'
  const isMarkdown = kind === 'markdown'
  const isRunning = status === 'running'
  const isError = status === 'error'
  // A user Stop or a timeout is not a code error — flag it distinctly so the
  // cell that the user halted is not mistaken for a clean run or a crash.
  const isHalted = status === 'interrupted' || status === 'timeout'
  const isSkipped = status === 'skipped'

  // Empty markdown cells stay in edit — preview of nothing is just a blank box.
  const showPreview = isMarkdown && viewMode === 'preview' && code.trim().length > 0

  useEffect(() => {
    if (showPreview) return
    const el = textareaRef.current
    if (el) autoResize(el)
  }, [code, showPreview])

  const enterEditMode = () => {
    onViewModeChange?.('edit')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div className="group/cell flex flex-col gap-2">
      <Card
        size="sm"
        className={cn(
          'relative gap-0 py-0 ring-0 border border-border overflow-visible transition-shadow',
          isError && 'border-destructive',
          isHalted && 'border-amber-500/60',
          isSkipped && 'border-dashed border-muted-foreground/40',
          isRunning &&
            'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-primary before:rounded-l-xl',
        )}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/40 rounded-t-xl">
          {isCode && isRunning && onStop ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Stop cell"
                    className="size-7 text-destructive hover:bg-destructive/10"
                    onClick={onStop}
                  >
                    <Square className="size-4 fill-current" />
                  </Button>
                }
              />
              <TooltipContent>Stop cell</TooltipContent>
            </Tooltip>
          ) : isCode && onRun ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Run cell"
                    className="size-7 text-success hover:bg-success/10"
                    disabled={isRunning}
                    onClick={onRun}
                  >
                    {isRunning ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </Button>
                }
              />
              <TooltipContent>Run cell (⌘+Enter)</TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground select-none">
              <Type className="size-3.5" />
              Text
            </div>
          )}

          {isCode ? (
            <span className="text-xs text-muted-foreground font-mono select-none">
              [{executionCount ?? ' '}]
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            {isMarkdown && onViewModeChange ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={showPreview ? 'Edit cell' : 'Preview cell'}
                      className="size-7"
                      onClick={() => onViewModeChange(showPreview ? 'edit' : 'preview')}
                    >
                      {showPreview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  }
                />
                <TooltipContent>{showPreview ? 'Edit (⌘+E)' : 'Preview (⌘+E)'}</TooltipContent>
              </Tooltip>
            ) : null}

            <div className="opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100 transition-opacity">
              {(onMoveUp || onMoveDown || onDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Cell options"
                        className="size-7"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    {onMoveUp && (
                      <DropdownMenuItem onClick={onMoveUp} disabled={isFirst}>
                        <ChevronUp className="size-4" /> Move up
                      </DropdownMenuItem>
                    )}
                    {onMoveDown && (
                      <DropdownMenuItem onClick={onMoveDown} disabled={isLast}>
                        <ChevronDown className="size-4" /> Move down
                      </DropdownMenuItem>
                    )}
                    {onDelete && (onMoveUp || onMoveDown) ? <DropdownMenuSeparator /> : null}
                    {onDelete && (
                      <DropdownMenuItem variant="destructive" onClick={onDelete}>
                        <Trash2 className="size-4" /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>

        {showPreview ? (
          <button
            type="button"
            onClick={enterEditMode}
            className="text-left w-full p-4 cursor-text rounded-b-xl text-foreground font-sans text-base leading-relaxed focus:bg-muted/30 outline-none"
            title="Click to edit"
          >
            <MarkdownView source={code} />
          </button>
        ) : isCode ? (
          <CodeEditor
            value={code}
            theme={theme}
            showLineNumbers={showLineNumbers}
            readOnly={readOnly}
            autoFocus={autoFocus}
            onChange={(next) => onCodeChange?.(next)}
            onFocus={onFocus}
            onRun={onRun}
            onRunAndAdvance={onRunAndAdvance}
            onRunAndInsertBelow={onRunAndInsertBelow}
            onExitToCommand={onExitToCommand}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={code}
            readOnly={readOnly}
            spellCheck
            rows={1}
            placeholder="Markdown — supports `# headings` for the outline"
            onChange={(e) => {
              onCodeChange?.(e.target.value)
              autoResize(e.target)
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                e.preventDefault()
                onViewModeChange?.('preview')
              }
            }}
            onInput={(e) => autoResize(e.currentTarget)}
            className="w-full resize-none bg-card text-foreground outline-none p-4 min-h-[60px] transition-colors rounded-b-xl focus:bg-muted/30 font-sans text-base leading-relaxed"
          />
        )}
      </Card>

      {isCode && output.length > 0 && <OutputView items={output} />}
    </div>
  )
}
