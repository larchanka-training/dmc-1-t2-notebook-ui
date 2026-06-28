import { useEffect, useRef } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Bot, Check, Cloud, Cpu, Send } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { RateLimitedError } from '@/shared/api/errors'
import { Textarea } from '@/shared/ui/textarea'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import {
  MODEL_CATALOG,
  downloadedModelIdsAtom,
  engineAtom,
  loadModelAction,
  loadedModelIdAtom,
  loadProgressAtom,
  loadingModelIdAtom,
  messagesAtom,
  modelIdAtom,
  sendMessageAction,
  streamingResponseAtom,
} from '@/features/web-llm'
import { cn } from '@/shared/lib/cn'
import { cloudMessagesAtom, cloudSendAction } from '../model/cloudPlayground'

function formatCloudSendError(err: Error): string {
  if (err instanceof RateLimitedError) {
    const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : ''
    return `Rate limit reached.${wait}`
  }

  const msg = err.message.toLowerCase()
  if (msg.includes('invalid_token') || msg.includes('401') || msg.includes('sign in')) {
    return 'Cloud AI requires sign-in. Log in and try again.'
  }
  if (msg.includes('prompt_rejected') || msg.includes('rejected')) {
    return 'Prompt was flagged by the safety filter.'
  }
  if (msg.includes('llm_timeout') || msg.includes('timeout')) {
    return 'Cloud generation timed out. Try again.'
  }
  if (
    msg.includes('llm_provider_not_configured') ||
    msg.includes('llm_provider_error') ||
    msg.includes('llm_unavailable') ||
    msg.includes('503') ||
    msg.includes('502')
  ) {
    return 'Cloud AI is temporarily unavailable. Try again later.'
  }
  if (msg.includes('request_too_large')) {
    return 'Prompt is too large for the cloud request.'
  }

  return `Cloud generation failed: ${err.message}`
}

// ── Local panel ──────────────────────────────────────────────────────────────

const LocalPanel = reatomComponent(() => {
  const engine = engineAtom()
  const modelId = modelIdAtom()
  const loadedModelId = loadedModelIdAtom()
  const progress = loadProgressAtom()
  const loadingModelId = loadingModelIdAtom()
  const messages = messagesAtom()
  const streaming = streamingResponseAtom()
  const bottomRef = useRef<HTMLDivElement>(null)
  // TARDIS-167 (№5/№15/№16): same model-select treatment as the notebook LLM bar.
  const downloaded = new Set(downloadedModelIdsAtom())
  const isSelectedLoaded = !!engine && loadedModelId === modelId
  // The picker stays enabled during a load; only the Load button for the model
  // already loading is a no-op. Picking another model mid-load supersedes it (H5).
  const isLoadingSelected = loadingModelId === modelId
  const actionLabel = isSelectedLoaded ? 'Reload' : 'Load'
  const actionHint = isSelectedLoaded
    ? 'Re-initialise the loaded model (clears its chat state)'
    : downloaded.has(modelId)
      ? 'Load this model into the browser (previously downloaded)'
      : 'Download and load this model into the browser'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  return (
    <div className="flex min-h-0 flex-1 flex-col border-r">
      {/* Column header */}
      <div className="border-b px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <Bot className="size-4 text-muted-foreground" />
          Local (In-Browser)
          {engine && (
            <span className="ml-auto rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
              ready
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Cpu className="size-4 shrink-0 text-muted-foreground" />
          <Select
            value={modelId}
            onValueChange={wrap((val: string | null) => val && modelIdAtom.set(val))}
          >
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {MODEL_CATALOG.map((m) => {
                const isDownloaded = downloaded.has(m.id)
                return (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    <span className="flex w-full items-center gap-4">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        {isDownloaded ? (
                          <Check className="size-3 shrink-0 text-primary" />
                        ) : (
                          <span className="size-3 shrink-0" />
                        )}
                        <span
                          className={cn('truncate', isDownloaded && 'font-medium text-primary')}
                        >
                          {m.id}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {m.size}
                      </span>
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant={isSelectedLoaded ? 'outline' : 'default'}
                  disabled={isLoadingSelected}
                  onClick={wrap(() => loadModelAction())}
                  className="shrink-0 text-xs"
                >
                  {isLoadingSelected ? 'Loading…' : actionLabel}
                </Button>
              }
            />
            <TooltipContent>{actionHint}</TooltipContent>
          </Tooltip>
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
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
            <Bot className="size-7" />
            <p className="text-sm">
              {engine ? 'Ready. Send a message below.' : 'Load a model to enable local responses.'}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-card text-card-foreground'
              }`}
            >
              {msg.content}
            </div>
          ))}
          {streaming && (
            <div className="max-w-[85%] rounded-lg bg-card px-3 py-2 text-sm text-card-foreground">
              {streaming}
              <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-current" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  )
}, 'LocalPanel')

// ── Cloud panel ───────────────────────────────────────────────────────────────

const CloudPanel = reatomComponent(() => {
  const messages = cloudMessagesAtom()
  const isSending = !cloudSendAction.ready()
  const sendError = cloudSendAction.error()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Column header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Cloud className="size-4 text-muted-foreground" />
          Cloud (AWS Bedrock)
          <span className="ml-auto rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            requires sign-in
          </span>
        </div>
        {sendError && (
          <p className="mt-1 text-xs text-destructive">{formatCloudSendError(sendError)}</p>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 && !isSending && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
            <Cloud className="size-7" />
            <p className="text-sm">Cloud responses will appear here.</p>
            <p className="text-xs">No local model required.</p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-card text-card-foreground'
              }`}
            >
              {msg.content}
            </div>
          ))}
          {isSending && (
            <div className="max-w-[85%] rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="animate-bounce [animation-delay:0ms]">·</span>
                <span className="animate-bounce [animation-delay:150ms]">·</span>
                <span className="animate-bounce [animation-delay:300ms]">·</span>
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  )
}, 'CloudPanel')

// ── Page ──────────────────────────────────────────────────────────────────────

const LlmPlaygroundPage = reatomComponent(() => {
  const isBusy = !sendMessageAction.ready() || !cloudSendAction.ready()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const doSend = wrap(() => {
    const val = textareaRef.current?.value.trim()
    if (!val || isBusy) return
    if (textareaRef.current) textareaRef.current.value = ''
    sendMessageAction(val)
    cloudSendAction(val)
  })

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">LLM Playground</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Send a message to both models simultaneously and compare responses side-by-side.
        </p>
      </div>

      {/* Two-column comparison */}
      <div className="flex min-h-0 flex-1">
        <LocalPanel />
        <CloudPanel />
      </div>

      {/* Shared input */}
      <div className="flex gap-2 border-t px-6 py-4">
        <Textarea
          ref={textareaRef}
          placeholder="Send a message to both models… (Enter to send, Shift+Enter for newline)"
          disabled={isBusy}
          rows={2}
          className="resize-none"
          onKeyDown={handleKeyDown}
        />
        <Button size="icon" onClick={doSend} disabled={isBusy} className="shrink-0 self-end">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  )
}, 'LlmPlaygroundPage')

export default LlmPlaygroundPage
