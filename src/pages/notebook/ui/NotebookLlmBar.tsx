import { useEffect } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Cpu, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import {
  AVAILABLE_MODELS,
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

  // Auto-load the smallest code model on first mount if no model is active or loading.
  const autoLoad = wrap(() => {
    if (!engineAtom() && !loadProgressAtom()) {
      modelIdAtom.set(AVAILABLE_MODELS[0])
      loadModelAction()
    }
  })
  // autoLoad is intentionally from the first render only — it captures the
  // Reatom context at mount time and must not re-run on subsequent renders.

  useEffect(() => {
    autoLoad()
  }, [])

  return (
    <div className="border-b bg-muted/30 px-6 py-2.5">
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
            {AVAILABLE_MODELS.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m}
              </SelectItem>
            ))}
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
