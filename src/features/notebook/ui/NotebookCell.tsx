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
import ReactMarkdown, { type Components } from 'react-markdown'
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
import type { CellKind, CellStatus, CellViewMode } from '../domain/cell'
import type { OutputItem } from '../runtime/types'
import { OutputView } from './OutputView'

export interface NotebookCellProps {
  /** Execution counter shown as `[N]`; null means the cell has never run. */
  executionCount?: number | null
  kind?: CellKind
  code: string
  output?: OutputItem[]
  status?: CellStatus
  viewMode?: CellViewMode
  isFirst?: boolean
  isLast?: boolean
  readOnly?: boolean
  onCodeChange?: (code: string) => void
  onViewModeChange?: (mode: CellViewMode) => void
  onRun?: () => void
  onStop?: () => void
  onDelete?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

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
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm">
          <code>{children}</code>
        </pre>
      )
    }
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]">{children}</code>
  },
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
}

export function NotebookCell({
  executionCount = null,
  kind = 'code',
  code,
  output = [],
  status = 'idle',
  viewMode = 'edit',
  isFirst = false,
  isLast = false,
  readOnly = false,
  onCodeChange,
  onViewModeChange,
  onRun,
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
            <ReactMarkdown components={markdownComponents}>{code}</ReactMarkdown>
          </button>
        ) : (
          <textarea
            ref={textareaRef}
            value={code}
            readOnly={readOnly}
            spellCheck={!isCode}
            rows={1}
            placeholder={isCode ? '' : 'Markdown — supports `# headings` for the outline'}
            onChange={(e) => {
              onCodeChange?.(e.target.value)
              autoResize(e.target)
            }}
            onKeyDown={(e) => {
              if (isCode && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                onRun?.()
              }
              if (isMarkdown && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                e.preventDefault()
                onViewModeChange?.('preview')
              }
            }}
            onInput={(e) => autoResize(e.currentTarget)}
            className={cn(
              'w-full resize-none bg-card text-foreground outline-none p-4 min-h-[60px] transition-colors rounded-b-xl focus:bg-muted/30',
              isCode ? 'font-mono text-sm leading-relaxed' : 'font-sans text-base leading-relaxed',
            )}
          />
        )}
      </Card>

      {isCode && output.length > 0 && <OutputView items={output} />}
    </div>
  )
}
