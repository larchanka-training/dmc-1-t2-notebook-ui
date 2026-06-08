import { useEffect } from 'react'
import { Code2, Plus, Type } from 'lucide-react'
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
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { NotebookCell } from './NotebookCell'
import { NotebookOutline } from './NotebookOutline'
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
import { lineNumbersAtom } from '../model/notebookSettings'
import { runCell, stopCell } from '../model/runtime'
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
      />
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

  if (variant === 'end') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="self-center text-muted-foreground">
              <Plus className="size-3.5" /> Add cell
            </Button>
          }
        />
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={onAddCode}>
            <Code2 className="size-4" /> Code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddText}>
            <Type className="size-4" /> Text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  return (
    <div className="group/inserter relative h-2 -my-3 flex items-center justify-center">
      <div className="absolute inset-x-0 h-px bg-transparent group-hover/inserter:bg-border transition-colors" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="relative z-10 h-6 px-2 text-xs opacity-0 group-hover/inserter:opacity-100 transition-opacity"
            >
              <Plus className="size-3" /> Add cell
            </Button>
          }
        />
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={onAddCode}>
            <Code2 className="size-4" /> Code
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddText}>
            <Type className="size-4" /> Text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}, 'CellInserter')

export const NotebookView = reatomComponent(() => {
  const cells = cellsAtom()

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
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          {/* Notebook-wide controls (autosave, search, run/kernel toolbar)
              now live in the global AppTopbar. The breadcrumb + editable
              doc-title that replace this static heading land in T4. SearchBar
              stays mounted here (toggled by the topbar button / ⌘F); it moves
              to a floating overlay in T6. */}
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">JS Notebook</h1>
          </header>
          <SearchBar />

          {/* autoScroll keeps the page scrolling when a drag nears the
              viewport edge on a long notebook; dnd-kit cancels an in-flight
              drag on Esc out of the box (pointer + keyboard sensors). */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            autoScroll={{ threshold: { x: 0, y: 0.15 } }}
          >
            <SortableContext items={cells.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-6">
                {cells.map((cell, idx) => (
                  <div key={cell.id} className="flex flex-col gap-6">
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

                <CellInserter
                  afterId={cells.length > 0 ? cells[cells.length - 1].id : undefined}
                  variant="end"
                />
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </main>

      <NotebookOutline />
    </div>
  )
}, 'NotebookView')
