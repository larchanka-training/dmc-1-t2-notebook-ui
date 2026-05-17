import { useState } from 'react'
import { Loader2, NotebookPen, Plus } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { createNotebookAction, notebookListResource } from '../model/notebookList'

interface NotebookListPanelProps {
  isLoading?: boolean
  loadError?: string
}

export const NotebookListPanel = reatomComponent<NotebookListPanelProps>(
  ({ isLoading = false, loadError }) => {
    const items = notebookListResource.data()
    const error = loadError ?? createNotebookAction.error()?.message

    const [title, setTitle] = useState('')

    const onCreate = wrap(async () => {
      const created = await createNotebookAction(title)
      if (created) setTitle('')
    })

    return (
      <div className="border-b bg-sidebar p-4 space-y-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Notebooks</span>
          {isLoading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <ul className="space-y-1">
          {items.map((nb) => (
            <li key={nb.id} className="text-sm flex items-center justify-between">
              <span className="truncate">{nb.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {new Date(nb.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
          {!isLoading && items.length === 0 ? (
            <li className="text-xs text-muted-foreground">No notebooks yet.</li>
          ) : null}
        </ul>

        <form
          className="flex items-center gap-2"
          onSubmit={wrap((e) => {
            e.preventDefault()
            onCreate()
          })}
        >
          <Input
            placeholder="New notebook title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={!title.trim()}>
            <Plus className="size-3.5" /> Create
          </Button>
        </form>
      </div>
    )
  },
  'NotebookListPanel',
)
