import { Check, Copy, RefreshCcw } from 'lucide-react'
import { action, atom, computed, withAsync, withAsyncData, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { notebook as notebookApi } from '@/shared/api'
import { DEMO_NOTEBOOK_ID } from '@/features/notebook'
import { DEMO_IMAGE_PNG_BASE64 } from '@/features/notebook/model/featureDemoNotebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import { Button } from '@/shared/ui/button'

const examples = [
  {
    title: 'Last expression → result',
    code: 'const x = 2 + 2\nx',
  },
  {
    title: 'console.log/info → stdout',
    code: "console.log('hello')\nconsole.info('same stdout channel')",
  },
  {
    title: 'console.warn/error → stderr',
    code: "console.warn('careful')\nconsole.error('boom')",
  },
  {
    title: 'HTML via display()',
    code: "display({ type: 'html', value: '<h1 style=\"color:tomato\">Hello from HTML output</h1>' })",
  },
  {
    title: 'Image via display() with raw base64',
    code: "display({ type: 'image', mime: 'image/png', data: '" + DEMO_IMAGE_PNG_BASE64 + "' })",
  },
  {
    title: 'SVG is easiest as HTML output',
    code: 'display({ type: \'html\', value: \'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><circle cx="60" cy="40" r="30" fill="gold"/></svg>\' })',
  },
  {
    title: 'Canvas lives inside the HTML iframe',
    code: "display({ type: 'html', value: `\n  <canvas id=\"c\" width=\"300\" height=\"150\"></canvas>\n  <script>\n    const ctx = document.getElementById('c').getContext('2d')\n    ctx.fillStyle = 'royalblue'\n    ctx.fillRect(10, 10, 120, 80)\n    ctx.fillStyle = 'tomato'\n    ctx.beginPath(); ctx.arc(220, 70, 50, 0, 2 * Math.PI); ctx.fill()\n  </script>\n` })",
  },
  {
    title: 'Multiple outputs keep their order',
    code: "console.log('first text')\ndisplay({ type: 'html', value: '<b>then HTML</b>' })\n42",
  },
] as const

function legacyCopy(text: string): boolean {
  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textArea)
    return copied
  } catch {
    return false
  }
}

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => legacyCopy(text),
    )
  }
  return Promise.resolve(legacyCopy(text))
}

const copiedExampleAtom = atom<string | null>(null, 'usage.copiedExample')

const copyExample = action(async (title: string, code: string) => {
  if (!(await wrap(copyText(code)))) return

  copiedExampleAtom.set(title)
  setTimeout(
    wrap(() => {
      if (copiedExampleAtom() === title) copiedExampleAtom.set(null)
    }),
    2000,
  )
}, 'usage.copyExample')

const CodeExample = reatomComponent(({ title, code }: { title: string; code: string }) => {
  const copied = copiedExampleAtom() === title

  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={wrap(() => copyExample(title, code))}
          aria-live="polite"
        >
          <Copy className="size-3.5" /> {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <pre className="max-w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius-item)] bg-muted p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </section>
  )
}, 'CodeExample')

const UsagePage = reatomComponent(() => {
  const restoring = !restoreDemo.ready()
  const error = restoreDemo.error()
  const demoExists = demoPresenceResource.data()

  return (
    <div className="mx-auto min-w-0 px-6 pt-12 pb-24 sm:px-10">
      <h1 className="mb-2 text-[34px] font-semibold tracking-tight">Usage</h1>
      <p className="mb-8 text-[17px] leading-relaxed text-muted-foreground">
        Copy-paste examples and the exact output contract used by code cells.
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
        <h2 className="text-[22px] font-semibold tracking-tight">What a cell run returns</h2>
        <p className="leading-relaxed text-foreground/90">
          Every run produces an ordered <code>OutputItem[]</code>. The renderer shows the items in
          the same order the runtime emitted them.
        </p>
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> <code>console.log</code> and{' '}
            <code>console.info</code> become <code>stdout</code>.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> <code>console.warn</code> and{' '}
            <code>console.error</code> become <code>stderr</code> with a prefix.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> A non-<code>undefined</code> trailing
            expression becomes <code>result</code>.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" /> A thrown exception becomes{' '}
            <code>error</code>.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" />{' '}
            <code>display({`{ type: 'html', value }`})</code> becomes <code>html</code>.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 size-4 text-primary" />{' '}
            <code>display({`{ type: 'image', mime, data }`})</code> becomes <code>image</code>.
          </li>
        </ul>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-[22px] font-semibold tracking-tight">Copyable examples</h2>
        <p className="leading-relaxed text-foreground/90">
          These snippets are meant to run directly in a code cell. Image <code>data</code> is raw
          base64 without a <code>data:</code> URL prefix.
        </p>
        <div className="grid min-w-0 gap-4">
          {examples.map((example) => (
            <CodeExample key={example.title} {...example} />
          ))}
        </div>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-[22px] font-semibold tracking-tight">Sandbox rules</h2>
        <p className="leading-relaxed text-foreground/90">
          Code cells run in a QuickJS/WASM sandbox. The cell runtime has no <code>fetch</code>,{' '}
          <code>window</code>, <code>document</code>, or <code>localStorage</code>.
        </p>
        <p className="leading-relaxed text-foreground/90">
          HTML output renders in a sandboxed iframe with inline scripts and styles allowed. Remote
          scripts such as CDN-hosted Chart.js are blocked by CSP; use inline code, inline styles,
          and <code>data:</code> or <code>blob:</code> images.
        </p>
      </section>

      <section className="rounded-[var(--radius-card)] border border-dashed border-border bg-[color-mix(in_oklch,var(--muted)_32%,var(--card))] p-5">
        <h2 className="mb-2 text-[22px] font-semibold tracking-tight">
          Where notebooks are stored
        </h2>
        <p className="leading-relaxed text-foreground/90">
          Before you edit the starter demo, it lives only in this browser. After the first edit, the
          notebook starts syncing to the server and can become available after reloads and on other
          devices when the network is available.
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
