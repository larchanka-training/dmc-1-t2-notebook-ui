import { KeyRound, Play, Save, Sparkles, Type } from 'lucide-react'

// Real, shipped features only. AI generation is surfaced separately as
// "In progress" (epic 07). Autosave persists locally to IndexedDB; for a
// signed-in user it also pushes to the server in the background (#134), the
// notebook list loads from the server on sign-in, and a sync-status indicator
// shows progress (#135). The copy stays honest about the async nature of sync
// (offline / expired token leave edits queued locally) and does not promise
// instant or guaranteed cross-device delivery.
const FEATURES = [
  {
    icon: Play,
    title: 'Runs in the browser',
    description:
      'Every code cell executes client-side via QuickJS/WASM. No server round-trip — output appears inline under each cell.',
  },
  {
    icon: Type,
    title: 'Rich Markdown & outline',
    description:
      'Headings, tables and highlighted code blocks render live, with an auto-generated outline of your document.',
  },
  {
    icon: Save,
    title: 'Autosaved & synced',
    description:
      'Notebooks autosave to your browser (IndexedDB) as you type. Once you sign in, edits also sync to the server in the background and your notebooks load back on sign-in — a status indicator shows where each save is.',
  },
  {
    icon: KeyRound,
    title: 'Passwordless sign-in',
    description:
      'Sign in with a one-time code sent to your email — no passwords to remember, reset or leak.',
  },
] as const

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card p-[18px]">
      <div className="mb-3 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-[18px]" />
      </div>
      <h3 className="mb-1 text-[15px] font-semibold">{title}</h3>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[720px] px-6 pt-12 pb-24 sm:px-10">
      {/* hero */}
      <h1 className="mb-1.5 text-[34px] font-semibold tracking-tight">JS Notebook</h1>
      <p className="mb-9 text-[17px] leading-relaxed text-muted-foreground">
        A browser-native, Jupyter-style notebook for JavaScript &amp; TypeScript. Write code in
        cells, run them instantly, and see output inline — no server, no setup.
      </p>

      {/* feature grid 2×2 */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} icon={f.icon} title={f.title} description={f.description} />
        ))}
      </div>

      {/* AI — explicitly in progress (epic 07), not shipped */}
      <div className="mt-3.5 flex items-start gap-3.5 rounded-[var(--radius-card)] border border-dashed border-border bg-card p-[18px]">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-[18px]" />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-[15px] font-semibold">AI code generation</h3>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
              In progress
            </span>
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            Describe a cell in plain language and get runnable code generated right below it.
            Landing in a coming release.
          </p>
        </div>
      </div>

      {/* how it works */}
      <h2 className="mt-9 mb-2.5 text-[22px] font-semibold tracking-tight">How it works</h2>
      <p className="text-[16px] leading-relaxed text-foreground/90">
        A notebook is an ordered list of cells. Code cells run JS/TS and show their output inline;
        text cells render Markdown. Reorder by dragging the gutter handle, insert between any two
        cells, and navigate large notebooks with the outline.
      </p>

      {/* keyboard first */}
      <h2 className="mt-9 mb-2.5 text-[22px] font-semibold tracking-tight">Keyboard first</h2>
      <p className="text-[16px] leading-relaxed text-foreground/90">
        Command mode for structural moves — add, delete and reorder cells — and edit mode for
        typing. Press{' '}
        <code className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[0.86em]">
          ?
        </code>{' '}
        anywhere for the full shortcut sheet.
      </p>

      {/* project meta */}
      <p className="mt-12 border-t border-border pt-6 text-[13px] text-muted-foreground">
        A training project — group <span className="font-medium text-foreground">TARDIS T2</span>.
        Built with React, TypeScript and Vite.
      </p>
    </div>
  )
}
