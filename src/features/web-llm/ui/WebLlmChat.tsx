import { useEffect, useRef } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Bot, Send, Cpu } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import {
  AVAILABLE_MODELS,
  engineAtom,
  loadModelAction,
  loadProgressAtom,
  messagesAtom,
  modelIdAtom,
  sendMessageAction,
  streamingResponseAtom,
} from '../model/webLlm'

export const WebLlmChat = reatomComponent(() => {
  const engine = engineAtom()
  const modelId = modelIdAtom()
  const progress = loadProgressAtom()
  const messages = messagesAtom()
  const streaming = streamingResponseAtom()
  const isLoading = !loadModelAction.ready()
  const isSending = !sendMessageAction.ready()
  const loadError = loadModelAction.error()
  const sendError = sendMessageAction.error()

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const doSend = wrap(() => {
    const val = textareaRef.current?.value.trim()
    if (!val || isSending || !engine) return
    if (textareaRef.current) textareaRef.current.value = ''
    sendMessageAction(val)
  })

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  const isReady = !!engine && !isLoading

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Model selector + load button */}
      <div className="flex items-center gap-3">
        <Cpu className="size-5 shrink-0 text-muted-foreground" />
        <Select
          value={modelId}
          onValueChange={wrap((val: string | null) => val && modelIdAtom.set(val))}
          disabled={isLoading}
        >
          <SelectTrigger className="w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABLE_MODELS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={wrap(() => {
            loadModelAction()
          })}
          disabled={isLoading}
          variant={engine ? 'outline' : 'default'}
        >
          {isLoading ? 'Loading…' : engine ? 'Reload model' : 'Load model'}
        </Button>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${Math.round(progress.progress * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{progress.text}</span>
        </div>
      )}

      {/* Errors */}
      {loadError && (
        <p className="text-sm text-destructive">Failed to load model: {loadError.message}</p>
      )}
      {sendError && <p className="text-sm text-destructive">Send failed: {sendError.message}</p>}

      {/* Chat area */}
      <ScrollArea className="flex-1 rounded-lg border bg-muted/30 p-4">
        {messages.length === 0 && !streaming && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
            <Bot className="size-8" />
            <p className="text-sm">
              {isReady ? 'Model ready. Send a message to start.' : 'Load a model to begin.'}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-card text-card-foreground'
              }`}
            >
              {msg.content}
            </div>
          ))}
          {streaming && (
            <div className="max-w-[80%] rounded-lg bg-card px-3 py-2 text-sm text-card-foreground">
              {streaming}
              <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-current" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          placeholder={
            isReady
              ? 'Send a message… (Enter to send, Shift+Enter for newline)'
              : 'Load a model first'
          }
          disabled={!isReady || isSending}
          rows={2}
          className="resize-none"
          onKeyDown={handleKeyDown}
        />
        <Button
          size="icon"
          onClick={doSend}
          disabled={!isReady || isSending}
          className="shrink-0 self-end"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  )
}, 'WebLlmChat')
