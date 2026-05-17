import { reatomComponent } from '@reatom/react'
import { NotebookListPanel, NotebookView, notebookListResource } from '@/features/notebook'

const NotebookPage = reatomComponent(() => {
  const isListLoading = !notebookListResource.ready()
  const loadError = notebookListResource.error()?.message
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
