import { useMemo } from 'react'
import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Clock } from 'lucide-react'
import { openNotebookInSlot } from '@/features/notebook'
import { cn } from '@/shared/lib/cn'
import { NOTEBOOK_PATH } from '@/shared/lib/paths'
import type { DashboardCard } from '../model/dashboardData'

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Relative "time ago" for the footer (mirrors the design's fmtAgo).
function formatRelative(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/**
 * A single dashboard notebook card (TARDIS-183). Layout from the
 * `Notebooks Dashboard.html` design (structure only — no tags / emoji / starred):
 * title heading on top, cell count below, the creation date in place of the
 * dropped description, and a footer separated by a rule whose right-aligned
 * relative "edited" time mirrors the design's `nb-foot`.
 *
 * Clicking opens the notebook into the slot and navigates to the notebook
 * route, exactly like a sidebar row: navigation is gated on a successful open
 * (`opened`/`already`) so a failed open keeps the current slot and route.
 *
 * A `reatomComponent` so its render runs inside a Reatom frame — `wrap` below
 * needs one (a plain function component throws `missing async stack`), same as
 * the sidebar's interactive rows.
 */
export const NotebookCard = reatomComponent(({ card }: { card: DashboardCard }) => {
  // Memoised (keyed by id) for a stable onClick identity across reatom
  // re-renders — same convention as DashboardPage's `onCreate`.
  const onOpen = useMemo(
    () =>
      wrap(async () => {
        const outcome = await wrap(openNotebookInSlot(card.id))
        if (outcome === 'opened' || outcome === 'already') {
          urlAtom.set((url) => new URL(NOTEBOOK_PATH, url.origin), true)
        }
      }),
    [card.id],
  )

  const cellsLabel =
    card.cellsCount === undefined
      ? null
      : `${card.cellsCount} ${card.cellsCount === 1 ? 'cell' : 'cells'}`

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col rounded-[var(--radius-card)] border border-border bg-card p-4 text-left',
        'transition-[box-shadow,border-color,transform] hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--primary)_40%,var(--border))] hover:shadow-[var(--shadow-pop)] cursor-pointer',
      )}
    >
      {/* Title heading */}
      <h3
        className="truncate text-[15px] font-semibold tracking-[-0.01em] transition-colors group-hover:text-primary"
        title={card.title}
      >
        {card.title}
      </h3>

      {/* Cell count */}
      {cellsLabel ? (
        <div className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono font-semibold text-[10.5px] px-[5px] py-[1px] rounded-[4px] bg-muted border border-border">
            JS
          </span>{' '}
          {cellsLabel}
        </div>
      ) : null}

      {/* Creation date (in place of the dropped description); min-height keeps
          cards aligned when it is absent (the synthetic floor card). */}
      <div className="mt-3 min-h-[18px] text-[13px] text-muted-foreground">
        {card.createdAt !== undefined ? `Created ${formatDate(card.createdAt)}` : null}
      </div>

      {/* Footer: separated by a rule; the relative "edited" time is pushed right. */}
      <div className="mt-4 flex items-center border-t border-border pt-3">
        {card.updatedAt !== undefined ? (
          <span
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            title={`Last edited ${formatDate(card.updatedAt)}`}
          >
            <Clock className="size-3.5" />
            {formatRelative(card.updatedAt)}
          </span>
        ) : null}
      </div>
    </button>
  )
}, 'NotebookCard')
