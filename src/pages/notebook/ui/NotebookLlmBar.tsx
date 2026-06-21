import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Check, Cpu, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import {
  MODEL_CATALOG,
  downloadedModelIdsAtom,
  engineAtom,
  loadModelAction,
  loadProgressAtom,
  modelIdAtom,
} from '@/features/web-llm'

export const NotebookLlmBar = reatomComponent(() => {
  const engine = engineAtom()
  const modelId = modelIdAtom()
  const progress = loadProgressAtom()
  const isLoading = !loadModelAction.ready()
  const loadError = loadModelAction.error()
  // TARDIS-167 (№5): models already downloaded into the browser are highlighted.
  const downloaded = new Set(downloadedModelIdsAtom())

  // TARDIS-167 (№4): model download is OPT-IN. There is deliberately NO auto-load
  // on mount — pulling a multi-GB model into the browser without consent ate the
  // memory of users who may not have it. The model loads ONLY when the user clicks
  // "Load model" below. Cell / Ask-agent in-browser generate stays disabled with a
  // tooltip until a model is loaded (see NotebookCell / AgentChatDialog).

  return (
    <div className="border-b border-border bg-muted/30 px-6 py-2.5">
      <div className="flex items-center gap-3">
        <Cpu className="size-4 shrink-0 text-muted-foreground" />
        <Select
          value={modelId}
          onValueChange={wrap((val: string | null) => val && modelIdAtom.set(val))}
          disabled={isLoading}
        >
          <SelectTrigger className="h-8 w-80 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_CATALOG.map((m) => {
              const isDownloaded = downloaded.has(m.id)
              return (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <span className="flex w-full items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5">
                      {isDownloaded ? <Check className="size-3 shrink-0 text-primary" /> : null}
                      <span className={isDownloaded ? 'font-medium text-primary' : undefined}>
                        {m.id}
                      </span>
                    </span>
                    <span className="text-muted-foreground">{m.size}</span>
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={wrap(() => {
            loadModelAction()
          })}
          disabled={isLoading}
          variant={engine ? 'outline' : 'default'}
          className="h-8 text-xs"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-1.5 size-3 animate-spin" />
              Loading…
            </>
          ) : engine ? (
            'Reload'
          ) : (
            'Load model'
          )}
        </Button>
      </div>

      {progress && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${Math.round(progress.progress * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{progress.text}</span>
        </div>
      )}

      {loadError && (
        <p className="mt-1.5 text-xs text-destructive">Failed to load: {loadError.message}</p>
      )}
    </div>
  )
}, 'NotebookLlmBar')
