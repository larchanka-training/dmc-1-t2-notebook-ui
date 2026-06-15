import { useEffect, useRef } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Cloud, Send } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { cloudMessagesAtom, cloudSendAction } from '../model/cloudPlayground'

export const CloudLlmChat = reatomComponent(() => {
  const messages = cloudMessagesAtom()
  const isSending = !cloudSendAction.ready()
  const sendError = cloudSendAction.error()

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const doSend = wrap(() => {
    const val = textareaRef.current?.value.trim()
    if (!val || isSending) return
    if (textareaRef.current) textareaRef.current.value = ''
    cloudSendAction(val)
  })

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {sendError && (
        <p className="text-sm text-destructive">Cloud generation failed: {sendError.message}</p>
      )}

      <ScrollArea className="flex-1 rounded-lg border bg-muted/30 p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
            <Cloud className="size-8" />
            <p className="text-sm">Describe what you want to build and get JavaScript code back.</p>
            <p className="text-xs">Powered by AWS Bedrock — no local model required.</p>
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
          {isSending && (
            <div className="max-w-[80%] rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
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

      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          placeholder="Describe what you want to build… (Enter to send, Shift+Enter for newline)"
          disabled={isSending}
          rows={2}
          className="resize-none"
          onKeyDown={handleKeyDown}
        />
        <Button size="icon" onClick={doSend} disabled={isSending} className="shrink-0 self-end">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  )
}, 'CloudLlmChat')
