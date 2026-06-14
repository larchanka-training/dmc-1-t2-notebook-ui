import { useEffect } from 'react'
import { Code2, Sparkles, Type } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { resolvedThemeAtom } from '@/entities/theme'
import { cn } from '@/shared/lib/cn'
import { NotebookCell } from './NotebookCell'
import { NotebookOutline } from './NotebookOutline'
import { NotebookHeader } from './NotebookHeader'
import { useCommandModeHotkeys } from './commandHotkeys'
import { SearchBar } from './SearchBar'
import { SortableCell } from './CellDragHandle'
import { redo, undo } from '../model/history'
import { isEditableTarget, useHotkeys } from '@/shared/lib/hotkeys'
import type { Cell, CellViewMode } from '../domain/cell'
import {
  addCell,
  cellsAtom,
  deleteCell,
  moveCell,
  moveCellTo,
  updateCellCode,
} from '../model/notebook'
import {
  activeCellIdAtom,
  cellModeAtom,
  enterCommand,
  enterEdit,
  focusCell,
} from '../model/cellMode'
import { lineNumbersAtom, outlineVisibleAtom } from '../model/notebookSettings'
import { hasOutlineAtom } from '../model/outline'
import { runCell, stopCell } from '../model/runtime'
import { codeGeneratorAtom, generateAndInsertCodeAction } from '../model/codeGenerator'
import { useIsMobile } from '@/shared/lib/use-mobile'
import { prewarmWorker } from '../runtime/workerHost'

// Run a cell, then focus the next one in edit mode — creating a trailing code
// cell if this was the last. Shift+Enter's "run and advance" behaviour.
// Markdown cells are never executed: the cell switches itself to preview, and
// here we only advance. So "run" applies to code cells only; markdown just
// renders + moves on.
function runAndAdvance(cellId: string) {
  const cells = cellsAtom()
  if (cells.find((c) => c.id === cellId)?.kind === 'code') runCell(cellId)
  const idx = cells.findIndex((c) => c.id === cellId)
  const next = cells[idx + 1] ?? addCell(cellId, 'code')
  enterEdit(next.id)
}

// Run a cell, then always insert a fresh code cell below and edit it.
// Alt+Enter's behaviour. Markdown is rendered (by the cell), not executed.
function runAndInsertBelow(cellId: string) {
  if (cellsAtom().find((c) => c.id === cellId)?.kind === 'code') runCell(cellId)
  const inserted = addCell(cellId, 'code')
  enterEdit(inserted.id)
}

interface NotebookRowProps {
  cell: Cell
  isFirst: boolean
  isLast: boolean
}

const NotebookRow = reatomComponent<NotebookRowProps>(({ cell, isFirst, isLast }) => {
  const isActive = activeCellIdAtom() === cell.id
  const mode = cellModeAtom()
  const hasGenerator = !!codeGeneratorAtom()
  const isGenerating = !generateAndInsertCodeAction.ready()
  const generateError = generateAndInsertCodeAction.error()
  // Note: search-match highlighting is subscribed inside CodeCellEditor (a thin
  // reactive wrapper), NOT here. Reading searchMatchesAtom in this row would
  // re-render the entire cell (card + toolbar + output) on every search
  // keystroke for every cell on screen.
  return (
    // Clicking the cell shell (outside the editor) puts it in command mode,
    // so the focus indicator also responds to the mouse, not just the keyboard.
    // A click that lands INSIDE the editor must NOT force command mode: the
    // editor's own focus handler already switches to edit, and a competing
    // focusCell() here would bubble afterwards and flip the indicator back to
    // command while the caret is actually in the editor.
    <div
      data-cell-id={cell.id}
      onClick={wrap((e: React.MouseEvent) => {
        if (!isEditableTarget(e.target)) focusCell(cell.id)
      })}
    >
      <NotebookCell
        executionCount={cell.executionCount()}
        kind={cell.kind}
        code={cell.code()}
        output={cell.output()}
        status={cell.status()}
        viewMode={cell.viewMode()}
        theme={resolvedThemeAtom()}
        showLineNumbers={lineNumbersAtom()}
        autoFocus={isActive && mode === 'edit'}
        active={isActive}
        mode={mode}
        cellId={cell.id}
        isFirst={isFirst}
        isLast={isLast}
        onCodeChange={wrap((code: string) => updateCellCode(cell.id, code))}
        onViewModeChange={wrap((mode: CellViewMode) => cell.viewMode.set(mode))}
        onFocus={wrap(() => enterEdit(cell.id))}
        onRun={wrap(() => runCell(cell.id))}
        onRunAndAdvance={wrap(() => runAndAdvance(cell.id))}
        onRunAndInsertBelow={wrap(() => runAndInsertBelow(cell.id))}
        onExitToCommand={wrap(() => {
          enterCommand()
          focusCell(cell.id)
        })}
        onStop={wrap(() => stopCell(cell.id))}
        onDelete={wrap(() => deleteCell(cell.id))}
        onMoveUp={wrap(() => moveCell(cell.id, -1))}
        onMoveDown={wrap(() => moveCell(cell.id, 1))}
        onInBrowserGenerate={
          cell.kind === 'markdown' ? wrap(() => generateAndInsertCodeAction(cell.id)) : undefined
        }
        generatorLoaded={hasGenerator}
        isGenerating={isGenerating}
      />
      {generateError && (
        <p className="px-3 py-1 text-xs text-destructive">
          Generate failed: {generateError.message}
        </p>
      )}
    </div>
  )
}, 'NotebookRow')

interface CellInserterProps {
  afterId?: string
  variant?: 'between' | 'end'
}

const CellInserter = reatomComponent<CellInserterProps>(({ afterId, variant = 'between' }) => {
  const onAddCode = wrap(() => {
    addCell(afterId, 'code')
  })
  const onAddText = wrap(() => {
    addCell(afterId, 'markdown')
  })

  // "Add cell" pill (new-design-v2 insert-strip): a rounded chip with an icon.
  const pill =
    'inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11.5px] font-medium text-foreground shadow-[var(--shadow-pop)] transition-colors hover:border-primary hover:text-primary'

  if (variant === 'end') {
    // Full-width dashed "Add cell" affordance at the end of the notebook.
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAddCode}
          className={cn(
            pill,
            'h-[34px] flex-1 justify-center rounded-[var(--radius-cell)] border-dashed shadow-none',
          )}
        >
          <Code2 className="size-3.5" /> Code
        </button>
        <button
          type="button"
          onClick={onAddText}
          className={cn(
            pill,
            'h-[34px] flex-1 justify-center rounded-[var(--radius-cell)] border-dashed shadow-none',
          )}
        >
          <Type className="size-3.5" /> Text
        </button>
      </div>
    )
  }
  // Between-cells gutter: a hairline that lights up on hover, revealing the
  // insert pills centred over it.
  return (
    <div className="group/inserter relative -my-2 flex h-[10px] items-center justify-center">
      <span className="absolute inset-x-0 h-px bg-primary opacity-0 transition-opacity group-hover/inserter:opacity-50" />
      <span className="relative z-[1] flex gap-1.5 opacity-0 transition-opacity group-hover/inserter:opacity-100">
        <button type="button" onClick={onAddCode} className={pill}>
          <Code2 className="size-[13px]" /> Code
        </button>
        <button type="button" onClick={onAddText} className={pill}>
          <Type className="size-[13px]" /> Text
        </button>
        {/* Ask agent (new-design-v2): drafts a cell from a prompt. Presentational
            slot for the LLM epic (07) — clicks but does nothing yet (no `ai`
            cell kind, no handler). Primary-tinted to read as an AI action. */}
        <button
          type="button"
          className={cn(pill, 'text-primary hover:border-primary hover:text-primary')}
        >
          <Sparkles className="size-[13px]" /> Ask agent
        </button>
      </span>
    </div>
  )
}, 'CellInserter')

export const NotebookView = reatomComponent(() => {
  const cells = cellsAtom()

  // Whether the outline pane actually occupies space right now: only on wide
  // layouts (≤1280px it is a floating drawer over a scrim, not a column), when
  // the user hasn't collapsed it, and when there are ≥ 2 headings to show. When
  // it does NOT, the editor column reclaims the outline's width — matching the
  // prototype's `.editor-wrap[data-outline="off"] .editor-col` widening.
  const isNarrow = useIsMobile()
  const outlineTakesSpace = !isNarrow && outlineVisibleAtom() && hasOutlineAtom()

  // Jupyter-style command-mode shortcuts (A/B/D D/M/Y/arrows/Enter).
  useCommandModeHotkeys()

  // Notebook-wide undo/redo. Mod combos fire even while typing in a cell.
  useHotkeys({
    'Mod-z': wrap(() => undo()),
    'Mod-Shift-z': wrap(() => redo()),
  })

  // Pointer drag needs a small activation distance so a click on the handle
  // (e.g. to focus) doesn't immediately start a drag. Keyboard sensor enables
  // accessible reordering (Space to lift, arrows to move, Space to drop).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = wrap((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const toIndex = cellsAtom().findIndex((c) => c.id === over.id)
    if (toIndex !== -1) moveCellTo(String(active.id), toIndex)
  })

  // Spin up the sandbox worker (chunk fetch + QuickJS init) as soon as the
  // notebook is on screen, so the user's first Run feels instant instead of
  // paying the cold-start cost. Skip this in Vitest: mounting NotebookView in
  // RTL tests does not need a warm worker, and eager worker import can race the
  // jsdom environment teardown.
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') prewarmWorker()
  }, [])

  return (
    // No own scroll port here: the shell's content area (AppLayout) scrolls, so
    // <main> and the sticky outline share one scroll context. The row must size
    // to its content height (NOT flex-1, which would cap it at one viewport and
    // make the sticky outline detach halfway down) so the outline stays pinned
    // for the whole scroll. min-h-full keeps a short notebook filling the area.
    <div className="flex min-h-full">
      <main className="flex-1">
        <div
          className="mx-auto w-full px-6 py-8"
          style={{
            // editor-width when the outline is visible; reclaim its width + gap
            // when it is hidden, so cells grow to fill the freed space.
            maxWidth: outlineTakesSpace
              ? 'var(--editor-width)'
              : 'calc(var(--editor-width) + var(--outline-width) + 40px)',
          }}
        >
          {/* Notebook-wide controls (autosave, search, run/kernel toolbar)
              live in the global AppTopbar. SearchBar stays mounted here
              (toggled by the topbar button / ⌘F). */}
          <NotebookHeader />
          <SearchBar />

          {/* autoScroll keeps the page scrolling when a drag nears the
              viewport edge on a long notebook; dnd-kit cancels an in-flight
              drag on Esc out of the box (pointer + keyboard sensors). */}
          {cells.length === 0 ? (
            // Minimal functional empty-state (#135): open-into-slot can now load a
            // 0-cell notebook (created via the sidebar "+"), and `deleteCell`
            // guards the last cell, so an empty notebook must offer a way out. The
            // end-inserter's Code/Text buttons already call addCell('code'|'markdown'),
            // so wrapping them with a caption is the whole feature — no new logic.
            // Final visual design (illustration, copy, layout) is #67 §6.
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                This notebook is empty. Add your first cell to get started.
              </p>
              <div className="w-full max-w-sm">
                <CellInserter variant="end" />
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
              autoScroll={{ threshold: { x: 0, y: 0.15 } }}
            >
              <SortableContext
                items={cells.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-3">
                  {cells.map((cell, idx) => (
                    <div key={cell.id} className="flex flex-col gap-3">
                      <SortableCell id={cell.id}>
                        <NotebookRow
                          cell={cell}
                          isFirst={idx === 0}
                          isLast={idx === cells.length - 1}
                        />
                      </SortableCell>
                      {idx < cells.length - 1 ? <CellInserter afterId={cell.id} /> : null}
                    </div>
                  ))}

                  <CellInserter afterId={cells[cells.length - 1].id} variant="end" />
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </main>

      <NotebookOutline />
    </div>
  )
}, 'NotebookView')
