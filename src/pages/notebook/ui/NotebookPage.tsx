import { reatomComponent } from '@reatom/react'
import { NotebookListPanel, NotebookView } from '@/features/notebook'
import { notebookRoute } from '../model/route'

const NotebookPage = reatomComponent(() => {
  const isListLoading = !notebookRoute.loader.ready()
  const loadError = notebookRoute.loader.error()?.message
  return (
    <div className="flex flex-col h-full">
      <NotebookListPanel isLoading={isListLoading} loadError={loadError} />
      <div className="flex-1 min-h-0">
        <NotebookView />
      </div>
    </div>
  )
}, 'NotebookPage')

export default NotebookPage
