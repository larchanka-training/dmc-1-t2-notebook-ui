import { useEffect, useRef } from 'react'
import {
  Play,
  Square,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Type,
  Eye,
  Pencil,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import { MarkdownSearchHighlight } from './MarkdownSearchHighlight'

// Toolbar icon button (new-design-v2 REC.toolBtn): square, muted, hover-filled.
const TOOL_BTN =
  'grid size-7 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

// Run button (new-design-v2 cell-runbtn): square with a soft success tint that
// deepens on hover; the Stop variant uses the destructive tint.
const RUN_BTN =
  'grid size-[26px] place-items-center rounded-[6px] border border-transparent text-success bg-[color-mix(in_oklch,var(--success)_12%,transparent)] transition-[background,transform] hover:bg-[color-mix(in_oklch,var(--success)_22%,transparent)] active:scale-[0.94] disabled:pointer-events-none'
const RUN_BTN_STOP =
  'grid size-[26px] place-items-center rounded-[6px] border border-transparent text-destructive bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] transition-[background,transform] hover:bg-[color-mix(in_oklch,var(--destructive)_22%,transparent)] active:scale-[0.94]'
import { modKeyLabel } from '@/shared/lib/platform'
import type { Theme } from '@/entities/theme'
import type { CellKind, CellStatus, CellViewMode } from '../domain/cell'
import type { OutputItem } from '../runtime/types'
import { CodeCellEditor } from './CodeCellEditor'
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
  /** Whether this cell currently holds focus (command or edit mode). */
  active?: boolean
  /** Modal state of the active cell; drives the focus indicator colour. */
  mode?: 'edit' | 'command'
  isFirst?: boolean
  isLast?: boolean
  readOnly?: boolean
  /** Cell id, used by the code editor to pull its notebook-search matches. */
  cellId?: string
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
  active = false,
  mode = 'command',
  isFirst = false,
  isLast = false,
  readOnly = false,
  cellId,
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
  // An error result is shown raw (red trace) without the "Output" label — the
  // error message is self-describing, the label would be noise (new-design-v2).
  const outputHasError = output.some((item) => item.type === 'error')

  // Empty markdown cells stay in edit — preview of nothing is just a blank box.
  const showPreview = isMarkdown && viewMode === 'preview' && code.trim().length > 0

  useEffect(() => {
    if (showPreview) return
    const el = textareaRef.current
    if (el) autoResize(el)
  }, [code, showPreview])

  // Markdown cells mirror CodeEditor's modal focus: when the cell becomes
  // active in edit mode (Enter in command mode, Shift+Enter advancing in),
  // pull focus into the textarea. If it is showing the preview, drop to edit
  // first so there is an input to focus. onViewModeChange is a freshly-wrapped
  // fn each render, so it is intentionally left out of the deps.
  useEffect(() => {
    if (!autoFocus || !isMarkdown) return
    if (showPreview) {
      onViewModeChange?.('edit')
      return
    }
    const el = textareaRef.current
    if (el && document.activeElement !== el) el.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, isMarkdown, showPreview])

  const enterEditMode = () => {
    onViewModeChange?.('edit')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // data-focus / data-state drive the cell rings + left mode bar (see the cell
  // state machine in index.css). focus = the modal state of the *active* cell;
  // state = the execution lifecycle. Kept as attributes (not Tailwind classes)
  // so the CSS owns the colour logic in one place.
  const dataFocus = active ? mode : 'none'
  const dataState = isRunning
    ? 'running'
    : isError
      ? 'error'
      : isHalted
        ? 'halted'
        : isSkipped
          ? 'skipped'
          : 'idle'

  return (
    <div className="group/cell flex flex-col gap-2">
      <article
        data-focus={dataFocus}
        data-state={dataState}
        className={cn(
          'cell relative overflow-visible rounded-[var(--radius-cell)] border border-border bg-card',
          'transition-[border-color,box-shadow]',
        )}
      >
        <div
          className={cn(
            'flex min-h-[32px] items-center gap-2.5 rounded-t-[var(--radius-cell)] py-[5px] pl-3 pr-1.5',
            // Code header: filled bar with a divider. Markdown header (new-design-v2):
            // a bare label row — no background tint and no bottom rule.
            isCode
              ? 'border-b border-border bg-[color-mix(in_oklch,var(--muted)_45%,var(--card))]'
              : 'border-b border-transparent',
          )}
        >
          {isCode && isRunning && onStop ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Stop cell"
                    className={RUN_BTN_STOP}
                    onClick={onStop}
                  >
                    <Square className="size-[15px] fill-current" />
                  </button>
                }
              />
              <TooltipContent>Stop cell</TooltipContent>
            </Tooltip>
          ) : isCode && onRun ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Run cell"
                    className={RUN_BTN}
                    disabled={isRunning}
                    onClick={onRun}
                  >
                    {isRunning ? (
                      <Loader2 className="size-[15px] animate-spin" />
                    ) : (
                      <Play className="size-[15px]" />
                    )}
                  </button>
                }
              />
              <TooltipContent>Run cell ({modKeyLabel}+Enter)</TooltipContent>
            </Tooltip>
          ) : (
            <span className="flex items-center gap-[7px] text-[12.5px] font-medium text-muted-foreground select-none">
              <Type className="size-3.5" />
              Text
            </span>
          )}

          {isCode ? (
            <span className="font-mono text-[12px] text-muted-foreground select-none">
              [{isRunning ? '*' : (executionCount ?? ' ')}]
            </span>
          ) : null}

          {/* Cell toolbar: all actions are visible buttons revealed on cell
              hover/focus (new-design-v2 — no "⋯" overflow menu). */}
          <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/cell:opacity-100 focus-within:opacity-100">
            {isMarkdown && onViewModeChange ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={showPreview ? 'Edit cell' : 'Preview cell'}
                      className={TOOL_BTN}
                      onClick={() => onViewModeChange(showPreview ? 'edit' : 'preview')}
                    >
                      {showPreview ? (
                        <Pencil className="size-[15px]" />
                      ) : (
                        <Eye className="size-[15px]" />
                      )}
                    </button>
                  }
                />
                <TooltipContent>
                  {showPreview ? `Edit (${modKeyLabel}+E)` : `Preview (${modKeyLabel}+E)`}
                </TooltipContent>
              </Tooltip>
            ) : null}

            {onMoveUp ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Move cell up"
                      className={TOOL_BTN}
                      disabled={isFirst}
                      onClick={onMoveUp}
                    >
                      <ChevronUp className="size-[15px]" />
                    </button>
                  }
                />
                <TooltipContent>Move up</TooltipContent>
              </Tooltip>
            ) : null}

            {onMoveDown ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Move cell down"
                      className={TOOL_BTN}
                      disabled={isLast}
                      onClick={onMoveDown}
                    >
                      <ChevronDown className="size-[15px]" />
                    </button>
                  }
                />
                <TooltipContent>Move down</TooltipContent>
              </Tooltip>
            ) : null}

            {onDelete ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Delete cell"
                      className={cn(TOOL_BTN, 'hover:bg-destructive/10 hover:text-destructive')}
                      onClick={onDelete}
                    >
                      <Trash2 className="size-[15px]" />
                    </button>
                  }
                />
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {showPreview ? (
          <button
            type="button"
            onClick={enterEditMode}
            className="text-left w-full p-4 cursor-text text-foreground font-sans text-base leading-relaxed focus:bg-muted/30 outline-none"
            title="Click to edit"
          >
            <MarkdownView source={code} />
          </button>
        ) : isCode ? (
          <CodeCellEditor
            cellId={cellId ?? ''}
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
          <div className="relative">
            {/* Search-match backdrop sits behind the textarea (which is
                transparent-bg) so matches in markdown source are highlighted
                too, not only in code cells. */}
            {cellId ? <MarkdownSearchHighlight cellId={cellId} source={code} /> : null}
            <textarea
              ref={textareaRef}
              value={code}
              readOnly={readOnly}
              spellCheck
              rows={1}
              placeholder="Markdown — supports `# headings` for the outline"
              // Mirror the code editor: focusing the textarea puts the cell in
              // edit mode, so the green left mode-bar shows for markdown too
              // (not just code). A plain mouse click that lands here would not
              // otherwise flip the mode.
              onFocus={onFocus}
              onChange={(e) => {
                onCodeChange?.(e.target.value)
                autoResize(e.target)
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
                  e.preventDefault()
                  onViewModeChange?.('preview')
                  return
                }
                // Enter combos mirror the code editor's run keymap, but a
                // markdown cell is RENDERED, not executed: we switch it to
                // preview instead of calling the kernel (runAndAdvance /
                // runAndInsertBelow skip the run for markdown). Blur first so
                // the destination cell — or the document-level command-mode
                // shortcuts — own the focus, not this textarea. A plain Enter
                // (no modifier) falls through and inserts a newline as usual.
                // Mod+Shift+Enter is the global "Run All" hotkey — let it bubble
                // to the document handler instead of running just this cell.
                if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
                  return
                }
                if (e.key === 'Enter' && (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  e.currentTarget.blur()
                  onViewModeChange?.('preview')
                  if (e.shiftKey) onRunAndAdvance?.()
                  else if (e.altKey) onRunAndInsertBelow?.()
                  // Cmd/Ctrl+Enter: render and stay on this cell (command mode).
                  else onExitToCommand?.()
                  return
                }
                // Esc leaves edit mode for command mode. Blur FIRST (like the
                // CodeEditor keymap): otherwise focus stays in the textarea and
                // the document-level command-mode shortcuts get typed as text.
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.currentTarget.blur()
                  onExitToCommand?.()
                }
              }}
              onInput={(e) => autoResize(e.currentTarget)}
              className="relative w-full resize-none bg-transparent text-foreground outline-none p-4 min-h-[60px] transition-colors focus:bg-muted/30 font-sans text-base leading-relaxed"
            />
          </div>
        )}

        {/* Execution result: a cell FOOTER (not a detached card) — split from
            the editor by a plain top rule. Only the cell itself is rounded; the
            footer's top edge is a straight line (new-design-v2). A clean run
            gets an "Output [N]" label; an error is shown raw, without it. */}
        {isCode && output.length > 0 ? (
          <div className="overflow-hidden rounded-b-[var(--radius-cell)] border-t border-border">
            {outputHasError ? null : (
              <div className="flex items-center gap-2 px-4 pt-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground select-none">
                Output [{isRunning ? '*' : (executionCount ?? ' ')}]
              </div>
            )}
            <OutputView items={output} />
          </div>
        ) : null}
      </article>
    </div>
  )
}
