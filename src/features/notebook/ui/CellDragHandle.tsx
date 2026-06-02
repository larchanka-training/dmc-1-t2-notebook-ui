import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

export interface SortableCellProps {
  id: string
  children: React.ReactNode
}

/**
 * Wraps a cell row in dnd-kit's sortable behaviour and renders a drag handle
 * (the `::`-style grip) on the left gutter. Only the handle starts a drag, so
 * selecting text or clicking inside the cell never triggers a reorder. The
 * handle is keyboard-focusable for accessible reordering.
 */
export function SortableCell({ id, children }: SortableCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    activeIndex,
    overIndex,
    index,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Show the drop indicator on the edge the dragged cell will land on: above
  // when moving up the list, below when moving down.
  const showDropBefore = isOver && !isDragging && activeIndex > overIndex
  const showDropAfter = isOver && !isDragging && activeIndex < overIndex && index === overIndex

  return (
    <div ref={setNodeRef} style={style} className={cn('group/drag relative', isDragging && 'z-10')}>
      {/* Drop indicator: a clearly visible pill bar + soft glow on the edge
          where the dragged cell will land, not a hairline. */}
      {showDropBefore && <DropIndicator position="top" />}
      {showDropAfter && <DropIndicator position="bottom" />}
      <div
        className={cn(
          'rounded-xl transition-all',
          isDragging && 'opacity-50 outline outline-2 outline-dashed outline-primary/50',
          isOver && !isDragging && 'bg-primary/5',
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label="Drag to reorder cell"
          className={cn(
            'absolute -left-7 top-2 flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground/50',
            'opacity-0 transition-opacity hover:bg-muted hover:text-muted-foreground group-hover/drag:opacity-100',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isDragging && 'cursor-grabbing opacity-100',
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

function DropIndicator({ position }: { position: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 z-20 flex items-center',
        position === 'top' ? '-top-3' : '-bottom-3',
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="h-1 flex-1 rounded-full bg-primary shadow-[0_0_8px] shadow-primary/60" />
      <span className="size-2 shrink-0 rounded-full bg-primary" />
    </div>
  )
}
