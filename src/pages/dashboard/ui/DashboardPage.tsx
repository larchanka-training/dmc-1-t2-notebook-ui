import { useMemo } from 'react'
import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Hash, Notebook, Plus } from 'lucide-react'
import { userAtom } from '@/entities/session'
import { canCreateNotebook, createNotebookFlow, slotOpenErrorAtom } from '@/features/notebook'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { NotebookCard } from './NotebookCard'
import { dashboardNotebooksResource } from '../model/dashboardData'

const CARD_GRID = 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]'

const NOTEBOOK_HREF = import.meta.env.BASE_URL

/**
 * Notebooks dashboard (TARDIS-183) — the start screen showing every notebook as
 * a card. Structure only from `Notebooks Dashboard.html`: a card grid + page
 * header. Tags, descriptions, categories, starred, filters, sorting and the
 * grid/list switch are deliberately out of scope.
 *
 * Auth-gated: the data resource reads `notebookListResource.data()` (which fires
 * `GET /notebooks` when hot), so the component returns null until a user is
 * signed in (guardrail G1 — never fetch the protected list as a guest). The
 * route is also wrapped in `AuthRouteGuard`; this is defence-in-depth and keeps
 * the resource cold on the login screen.
 */
const DashboardPage = reatomComponent(() => {
  const user = userAtom()
  if (!user) return null

  const cards = dashboardNotebooksResource.data()
  // `isEverSettled` is false until the first merge resolves, so a cold load shows
  // a skeleton instead of flashing the (otherwise indistinguishable) empty list.
  const settled = dashboardNotebooksResource.status().isEverSettled
  // A failed open (e.g. offline with no local copy) surfaces here — the same atom
  // the slot controller sets and the sidebar shows, so a "dead" card click is
  // explained rather than silent.
  const openError = slotOpenErrorAtom()

  // Memoised so `Button`/`onClick` identity is stable across the frequent
  // reatom re-renders (one `wrap` callback, empty deps).
  const onCreate = useMemo(
    () =>
      wrap(async () => {
        const created = await wrap(createNotebookFlow())
        if (created) urlAtom.set((url) => new URL(NOTEBOOK_HREF, url.origin), true)
      }),
    [],
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pt-9 pb-24 sm:px-10">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[34px]">
              Your notebooks
            </h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
              Pick one up where you left off, or start a new scratchpad.
            </p>
          </div>
          {/* Primary create action, top-right (the design's topbar slot). Disabled
              at the notebook cap, mirroring the sidebar "+". */}
          <Button className="mt-1 shrink-0" onClick={onCreate} disabled={!canCreateNotebook()}>
            <Plus className="size-4" />
            New notebook
          </Button>
        </header>

        {openError ? (
          <p role="alert" className="mb-5 text-sm text-destructive">
            {openError}
          </p>
        ) : null}

        {/* Loading vs loaded.
            settled (the welcome seed guarantees a notebook — see
            `mergeDashboardCards`'s floor row), so there is no empty-state: a
            settled-but-empty list is unreachable. A brand-new user still has the
            top-right "New notebook" action. */}
        {!settled ? (
          <div className={CARD_GRID} aria-busy="true" aria-label="Loading notebooks">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-[var(--radius-card)]" />
            ))}
          </div>
        ) : (
          <>
            <div className="mb-7 grid grid-cols-2 gap-3">
              <StatCard icon={Notebook} value={cards.length} label="Notebooks" />
              <StatCard
                icon={Hash}
                value={cards.reduce((sum, c) => sum + (c.cellsCount ?? 0), 0)}
                label="Total cells"
              />
            </div>
            <div className={CARD_GRID}>
              {cards.map((card) => (
                <NotebookCard key={card.id} card={card} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}, 'DashboardPage')

// A stat-strip tile (new-design-v2): a tinted square icon + a big number over a
// muted label. Only the two stats the task keeps — Notebooks + Total cells —
// are surfaced (Starred / Unsaved are out of scope).
function StatCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Notebook
  value: number
  label: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card px-[14px] py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[color-mix(in_oklch,var(--primary)_12%,transparent)] text-primary">
        <Icon className="size-[18px]" />
      </div>
      <div className="leading-tight">
        <div className="text-[20px] font-semibold tracking-[-0.01em]">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

export default DashboardPage
