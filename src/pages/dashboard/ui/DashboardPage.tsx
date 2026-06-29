import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { userAtom } from '@/entities/session'
import { createNotebookFlow } from '@/features/notebook'
import { Button } from '@/shared/ui/button'
import { NotebookCard } from './NotebookCard'
import { dashboardNotebooksResource } from '../model/dashboardData'

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

  const onCreate = wrap(async () => {
    const created = await wrap(createNotebookFlow())
    if (created) urlAtom.set((url) => new URL(NOTEBOOK_HREF, url.origin), true)
  })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pt-9 pb-24 sm:px-10">
        <header className="mb-7">
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[34px]">
            Your notebooks
          </h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
            Pick one up where you left off, or start a new scratchpad.
          </p>
        </header>

        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-base font-semibold">No notebooks yet</div>
            <p className="mt-1 max-w-[36ch] text-sm text-muted-foreground">
              Create your first notebook to get started.
            </p>
            <Button className="mt-4" onClick={onCreate}>
              New notebook
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
            {cards.map((card) => (
              <NotebookCard key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}, 'DashboardPage')

export default DashboardPage
