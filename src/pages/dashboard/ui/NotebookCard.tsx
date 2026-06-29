import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { openNotebookInSlot } from '@/features/notebook'
import { cn } from '@/shared/lib/cn'
import type { DashboardCard } from '../model/dashboardData'

// The notebook route is the app base ('' under it) — same href the sidebar uses.
const NOTEBOOK_HREF = import.meta.env.BASE_URL

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * A single dashboard notebook card (TARDIS-183). Structure only from the
 * `Notebooks Dashboard.html` design — no tags / description / emoji / starred.
 * Clicking opens the notebook into the slot and navigates to the notebook
 * route, exactly like a sidebar row: navigation is gated on a successful open
 * (`opened`/`already`) so a failed open keeps the current slot and route.
 *
 * A `reatomComponent` so its render runs inside a Reatom frame — `wrap` below
 * needs one (a plain function component throws `missing async stack`), same as
 * the sidebar's interactive rows.
 */
export const NotebookCard = reatomComponent(({ card }: { card: DashboardCard }) => {
  const onOpen = wrap(async () => {
    const outcome = await wrap(openNotebookInSlot(card.id))
    if (outcome === 'opened' || outcome === 'already') {
      urlAtom.set((url) => new URL(NOTEBOOK_HREF, url.origin), true)
    }
  })

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
        'transition-[box-shadow,border-color,transform] hover:-translate-y-px hover:border-[color-mix(in_oklch,var(--primary)_40%,var(--border))] hover:shadow-[var(--shadow-pop)]',
      )}
    >
      <h3
        className="truncate text-[15px] font-semibold tracking-[-0.01em] transition-colors group-hover:text-primary"
        title={card.title}
      >
        {card.title}
      </h3>

      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {cellsLabel ? <span>{cellsLabel}</span> : null}
        {cellsLabel && card.updatedAt !== undefined ? <span>·</span> : null}
        {card.updatedAt !== undefined ? (
          <span title="Last edited">Edited {formatDate(card.updatedAt)}</span>
        ) : null}
      </div>

      {card.createdAt !== undefined ? (
        <div className="mt-1 text-[11px] text-muted-foreground/80">
          Created {formatDate(card.createdAt)}
        </div>
      ) : null}
    </button>
  )
}, 'NotebookCard')
