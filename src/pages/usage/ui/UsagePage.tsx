import { Check, Copy, RefreshCcw } from 'lucide-react'
import { action, atom, computed, urlAtom, withAsync, withAsyncData, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { notebook as notebookApi } from '@/shared/api'
import { userAtom } from '@/entities/session'
import {
  activeNotebookIdAtom,
  clearSeedTombstone,
  isSeedTombstoned,
  notebookListResource,
  openNotebookInSlot,
  resolveDemoNotebookId,
  upsertListItem,
} from '@/features/notebook'
import { DEMO_IMAGE_PNG_BASE64 } from '@/features/notebook/model/featureDemoNotebook'
import { notebookStorage } from '@/features/notebook/persistence/activeStorage'
import { appPath } from '@/shared/lib/paths'
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
  // TARDIS-167 (№22): the seed-restore block only makes sense for a signed-in
  // user (the demo notebook id is per-owner). Public visitors see the examples
  // only. `demoExists` is forced true when signed out, but gate on the user too.
  const isSignedIn = userAtom() !== null
  const demoExists = demoPresenceResource.data()

  return (
    <div className="mx-auto min-w-0 px-6 pt-12 pb-24 sm:px-10">
      <h1 className="mb-2 text-[34px] font-semibold tracking-tight">Usage</h1>
      <p className="mb-8 text-[17px] leading-relaxed text-muted-foreground">
        Copy-paste examples and the exact output contract used by code cells.
      </p>

      {isSignedIn && !demoExists ? (
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

const demoPresenceResource = computed(async () => {
  // TARDIS-167 (№22): Usage is PUBLIC. Check the user FIRST, before any other
  // reactive read — `notebookListResource.data()` is not a harmless cache peek but
  // the async list resource's trigger, so reading it while signed out makes it hot
  // and fires the protected `GET /notebooks` WITHOUT a token (a 401 on a public
  // page — the same №8 trap the sidebar guards against by checking `user` first).
  // A signed-out visitor has no per-account seed to restore, so report "present"
  // (true) to keep the restore block hidden and never touch the list/resolver.
  if (!userAtom()) return true
  // Reactive triggers, read SYNCHRONOUSLY before the first await (a computed only
  // tracks dependencies up to its first await; the tombstone/storage reads below
  // are async and don't register). Deleting or restoring the seed mutates the
  // notebook list and the active slot id, so touching them here invalidates this
  // resource — the restore button then appears/disappears on the next navigation
  // to Usage, without a full page reload (TARDIS-167 №23).
  notebookListResource.data()
  activeNotebookIdAtom()
  // The seed counts as "present" only when NOT tombstoned: a deleted seed has a
  // durable tombstone (№23), and after a delete a stale local copy may still sit
  // in storage — so a tombstone means "deleted", and the restore block must show.
  if (await wrap(isSeedTombstoned())) return false
  const demoId = await wrap(resolveDemoNotebookId())
  return Boolean(await wrap(notebookStorage.get(demoId)))
}, 'usage.demoPresence').extend(withAsyncData({ initState: true }))

const restoreDemo = action(async () => {
  // Recreate the per-account seed server-side, then make it the real current
  // notebook locally (TARDIS-167 №23 / #61 #67):
  //   1. lift the deleted-seed tombstone so boot stops suppressing it;
  //   2. write the returned document to storage;
  //   3. stamp owner + remoteCreated sync-state so the owner-scoped boot picker
  //      and the sidebar treat it as this user's notebook (it already exists
  //      server-side — we just created it);
  //   4. open it in the editor slot so the user sees the result immediately.
  const restored = await wrap(notebookApi.restoreFeaturesDemo())
  await wrap(clearSeedTombstone())
  await wrap(notebookStorage.put(restored))
  const ownerId = userAtom()?.id
  await wrap(
    notebookStorage.putSyncState({
      notebookId: restored.id,
      remoteCreated: true,
      dirty: false,
      deletedCells: [],
      ...(ownerId !== undefined ? { ownerId } : {}),
      lastSyncedUpdatedAt: restored.updatedAt,
    }),
  )
  // Surface the restored seed in the sidebar list immediately (no GET refetch), so
  // it does not show only as the synthetic floor row and vanish the moment another
  // notebook is opened before the next list fetch.
  upsertListItem(restored)
  demoPresenceResource.data.set(true)
  await wrap(openNotebookInSlot(restored.id))
  // TARDIS-167 №23 (review #4): leave the Usage page for the editor so the user
  // lands on the just-restored notebook instead of staying on /usage with no
  // visible result. SPA navigation via the router base (notebook route is '/').
  urlAtom.set((url) => new URL(appPath(''), url.origin), true)
}, 'usage.restoreDemo').extend(withAsync())

export default UsagePage
