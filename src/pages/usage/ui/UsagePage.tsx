import { Check, Copy, RefreshCcw } from 'lucide-react'
import { action, computed, withAsync, withAsyncData, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { notebook as notebookApi } from '@/shared/api'
import { DEMO_NOTEBOOK_ID } from '@/features/notebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import { Button } from '@/shared/ui/button'

const examples = [
  {
    title: 'stdout, stderr and the last expression result',
    code: 'console.log("hello stdout")\nconsole.error("hello stderr")\nconst total = [1, 2, 3].reduce((a, b) => a + b, 0)\ntotal',
  },
  {
    title: 'HTML display output',
    code: 'display({ type: "html", value: `<button onclick="this.textContent = \'Clicked\'">Click inside iframe</button>` })',
  },
  {
    title: 'Canvas via sandboxed HTML iframe',
    code: 'display({ type: "html", value: `<canvas id="c" width="240" height="90"></canvas><script>const ctx = document.getElementById("c").getContext("2d"); ctx.fillStyle = "#7c3aed"; ctx.fillRect(10, 10, 220, 70); ctx.fillStyle = "white"; ctx.font = "20px system-ui"; ctx.fillText("Canvas", 82, 56);</script>` })',
  },
  {
    title: 'Inline image output',
    code: 'display({ type: "image", mime: "image/svg+xml", data: btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" rx="16" fill="#0f172a"/><text x="32" y="68" fill="white" font-size="24" font-family="system-ui">SVG image</text></svg>`) })',
  },
] as const

function CodeExample({ title, code }: { title: string; code: string }) {
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(code)}
        >
          <Copy className="size-3.5" /> Copy
        </Button>
      </div>
      <pre className="max-w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius-item)] bg-muted p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </section>
  )
}

const UsagePage = reatomComponent(() => {
  const restoring = !restoreDemo.ready()
  const error = restoreDemo.error()
  const demoExists = demoPresenceResource.data()

  return (
    <div className="mx-auto min-w-0 max-w-[820px] px-6 pt-12 pb-24 sm:px-10">
      <h1 className="mb-2 text-[34px] font-semibold tracking-tight">Usage</h1>
      <p className="mb-8 text-[17px] leading-relaxed text-muted-foreground">
        Practical rules for writing code cells and reading their outputs in JS Notebook.
      </p>

      {!demoExists ? (
        <div className="mb-8 rounded-[var(--radius-card)] border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Feature demo notebook</h2>
              <p className="text-sm text-muted-foreground">
                Restore the canonical demo notebook for this account when its local copy is absent.
              </p>
            </div>
            <Button type="button" onClick={wrap(() => restoreDemo())} disabled={restoring}>
              <RefreshCcw className="size-4" /> {restoring ? 'Restoring…' : 'Restore demo'}
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-destructive">Restore failed: {error.message}</p>
          ) : null}
        </div>
      ) : null}

      <section className="mb-8 space-y-3">
        <h2 className="text-[22px] font-semibold tracking-tight">Output model</h2>
        <p className="leading-relaxed text-foreground/90">
          A run produces an ordered <code>OutputItem[]</code>: <code>stdout</code>,{' '}
          <code>stderr</code>, <code>result</code>, <code>error</code>, <code>html</code> and{' '}
          <code>image</code> items render in the same order the runtime emitted them.
        </p>
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> Adjacent stdout/stderr lines are
            visually grouped.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> The last expression becomes a result
            item.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> HTML renders in a sandboxed iframe.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> Images require an explicit MIME type
            and base64 data.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-[22px] font-semibold tracking-tight">Sandbox rules</h2>
        <p className="leading-relaxed text-foreground/90">
          Code cells run in a QuickJS/WASM worker sandbox: no <code>fetch</code>,{' '}
          <code>window</code>, <code>document</code> or <code>localStorage</code> in the cell
          runtime.
        </p>
        <p className="leading-relaxed text-foreground/90">
          Interactive browser APIs such as canvas belong inside <code>html</code> output iframes,
          which are sandboxed with a restrictive CSP and no CDN/network access.
        </p>
      </section>

      <div className="mb-8 grid min-w-0 gap-4">
        {examples.map((example) => (
          <CodeExample key={example.title} {...example} />
        ))}
      </div>

      <section className="rounded-[var(--radius-card)] border border-dashed border-border bg-[color-mix(in_oklch,var(--muted)_32%,var(--card))] p-5">
        <h2 className="mb-2 text-[22px] font-semibold tracking-tight">Storage note</h2>
        <p className="leading-relaxed text-foreground/90">
          Notebooks autosave to this browser first. Signed-in sync is asynchronous, so a local edit
          is durable only in this browser until the sync indicator confirms the server accepted it.
        </p>
      </section>
    </div>
  )
}, 'UsagePage')

const demoPresenceResource = computed(
  async () => Boolean(await wrap(notebookStorage.get(DEMO_NOTEBOOK_ID))),
  'usage.demoPresence',
).extend(withAsyncData({ initState: true }))

const restoreDemo = action(async () => {
  const restored = await wrap(notebookApi.restoreFeaturesDemo())
  await wrap(notebookStorage.put(restored))
  demoPresenceResource.data.set(true)
}, 'usage.restoreDemo').extend(withAsync())

export default UsagePage
