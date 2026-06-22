import { useRef } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Bot, Cloud, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import {
  agentChatOpenAtom,
  agentSendAction,
  agentSendInBrowserAction,
  closeAgentChatAction,
} from '../model/agentChat'
import { codeGeneratorAtom } from '../model/codeGenerator'

export const AgentChatDialog = reatomComponent(() => {
  const open = agentChatOpenAtom()
  const isCloudSending = !agentSendAction.ready()
  const isInBrowserSending = !agentSendInBrowserAction.ready()
  const isSending = isCloudSending || isInBrowserSending
  // In-browser tier needs a loaded WebLLM model (№4/№13): the generator slot is
  // null until the user loads one. Mirror the cell toolbar's gate.
  const hasLocalModel = !!codeGeneratorAtom()
  const sendError = agentSendAction.error() ?? agentSendInBrowserAction.error()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const doSendCloud = wrap(() => {
    const val = textareaRef.current?.value.trim()
    if (!val || isSending) return
    agentSendAction(val)
  })

  const doSendInBrowser = wrap(() => {
    const val = textareaRef.current?.value.trim()
    if (!val || isSending || !hasLocalModel) return
    agentSendInBrowserAction(val)
  })

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Enter defaults to the cloud tier (always available), matching the prior
      // single-button behaviour so the keyboard flow is unchanged.
      doSendCloud()
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
            placeholder="e.g. generate the first 20 Fibonacci numbers and log them…"
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

          {/* TARDIS-167 (№13): two explicit tiers, like the cell toolbar —
              in-browser (WebLLM) and cloud — so it is clear which agent runs.
              Hints use Tooltip (matching the cell toolbar), which surfaces the
              "load a model first" reason even on the disabled in-browser button
              — native `title` is unreliable on disabled controls (review PR #88). */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={wrap(() => closeAgentChatAction())}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    onClick={doSendInBrowser}
                    disabled={isSending || !hasLocalModel}
                    className="gap-2"
                  >
                    {isInBrowserSending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Bot className="size-4" />
                    )}
                    In-browser
                  </Button>
                }
              />
              <TooltipContent>
                {hasLocalModel
                  ? 'Generate with the in-browser model (WebLLM)'
                  : 'Load an in-browser model first'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button onClick={doSendCloud} disabled={isSending} className="gap-2">
                    {isCloudSending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Cloud className="size-4" />
                    )}
                    Cloud
                  </Button>
                }
              />
              <TooltipContent>Generate with the cloud agent</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'AgentChatDialog')
