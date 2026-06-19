import { useRef } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { agentChatOpenAtom, agentSendAction, closeAgentChatAction } from '../model/agentChat'

export const AgentChatDialog = reatomComponent(() => {
  const open = agentChatOpenAtom()
  const isSending = !agentSendAction.ready()
  const sendError = agentSendAction.error()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const doSend = wrap(() => {
    const val = textareaRef.current?.value.trim()
    if (!val || isSending) return
    agentSendAction(val)
  })

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  const handleOpenChange = wrap((next: boolean) => {
    if (!next) closeAgentChatAction()
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Ask agent
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Describe what you need. The agent will generate an answer and insert it below as a code or
          text cell.
        </p>

        <div className="flex flex-col gap-3">
          <Textarea
            ref={textareaRef}
            placeholder="e.g. fetch a list of GitHub repos for a user and log the names…"
            rows={4}
            className="resize-none"
            disabled={isSending}
            autoFocus
            onKeyDown={handleKeyDown}
          />

          {sendError && (
            <p className="text-sm text-destructive">
              {sendError.message.includes('prompt_rejected')
                ? 'Prompt was flagged by the safety filter. Try rephrasing.'
                : `Generation failed: ${sendError.message}`}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={wrap(() => closeAgentChatAction())}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button onClick={doSend} disabled={isSending} className="gap-2">
              {isSending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Generate code
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'AgentChatDialog')
