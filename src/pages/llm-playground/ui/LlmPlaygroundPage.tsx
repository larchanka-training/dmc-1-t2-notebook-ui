import { Bot } from 'lucide-react'
import { reatomComponent } from '@reatom/react'
import { WebLlmChat } from '@/features/web-llm'
import { engineAtom, modelIdAtom } from '@/features/web-llm'

const LlmPlaygroundPage = reatomComponent(() => {
  const engine = engineAtom()
  const modelId = modelIdAtom()

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">LLM Playground</h1>
          {engine && (
            <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Bot className="size-3.5" />
              {modelId}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Run a local language model in the browser — no server required.
        </p>
      </div>
      <WebLlmChat />
    </div>
  )
}, 'LlmPlaygroundPage')

export default LlmPlaygroundPage
