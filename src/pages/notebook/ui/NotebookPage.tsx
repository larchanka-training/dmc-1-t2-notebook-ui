import { reatomComponent } from '@reatom/react'
import { NotebookView, notebookLoadedAtom } from '@/features/notebook'
import { Skeleton } from '@/shared/ui/skeleton'
import { NotebookLlmBar } from './NotebookLlmBar'

// Gate the editor behind a skeleton until the boot-time load has settled.
// `loadNotebook` reads IndexedDB asynchronously; rendering NotebookView before
// it resolves would let the user type into the seed, only for that input to be
// overwritten when the stored cells arrive. NotebookView itself stays gate-free
// (and so do its tests) — the gate lives here, at the route boundary.
const NotebookPage = reatomComponent(() => {
  if (!notebookLoadedAtom()) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8" aria-busy="true">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-8 h-40 w-full" />
      </div>
    )
  }
  return (
    <div className="flex min-h-full flex-col">
      <NotebookLlmBar />
      <div className="flex-1">
        <NotebookView />
      </div>
    </div>
  )
}, 'NotebookPage')

export default NotebookPage
