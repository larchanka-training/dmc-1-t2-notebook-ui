import { useState } from 'react'
import { Separator } from '@/shared/ui/separator'
import { NotebookCell, executeJS } from '@/features/notebook'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
      <Separator className="mt-4" />
    </div>
  )
}

function PropTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="rounded-lg border overflow-hidden text-xs">
      <div className="grid grid-cols-3 bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground uppercase tracking-wider">
        <span>Prop</span>
        <span>Type</span>
        <span>Description</span>
      </div>
      {rows.map(([prop, type, desc]) => (
        <div key={prop} className="grid grid-cols-3 px-3 py-2 border-t even:bg-muted/10">
          <code className="text-primary">{prop}</code>
          <code className="text-muted-foreground">{type}</code>
          <span className="text-muted-foreground">{desc}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({
  label,
  color = 'default',
}: {
  label: string
  color?: 'default' | 'success' | 'warning' | 'error'
}) {
  const colors = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-green-500/15 text-green-600 dark:text-green-400',
    warning: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
    error: 'bg-red-500/15 text-red-600 dark:text-red-400',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}
    >
      {label}
    </span>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="border rounded-xl p-4 bg-card min-w-[140px] space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {delta && <p className="text-xs text-green-500">{delta}</p>}
    </div>
  )
}

// ─── CodeTag ──────────────────────────────────────────────────────────────────

function CodeTag({ children }: { children: string }) {
  return (
    <code className="rounded-md bg-muted px-2 py-1 text-xs font-mono text-foreground">
      {children}
    </code>
  )
}

// ─── Live NotebookCell demo ───────────────────────────────────────────────────

function LiveCellDemo() {
  const [code, setCode] = useState(
    'const nums = [1, 2, 3, 4, 5]\nconsole.log(nums.map(n => n * 2))',
  )
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')

  const run = async () => {
    setStatus('running')
    setOutput('')
    const result = await executeJS(code)
    setOutput(result.output)
    setStatus(result.error ? 'error' : 'done')
  }

  return (
    <NotebookCell
      index={1}
      code={code}
      output={output}
      status={status}
      isFirst
      isLast
      onCodeChange={setCode}
      onRun={run}
    />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomComponentsPage() {
  return (
    <div className="p-8 max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Custom Components</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Components built for this project — extracted from pages and reusable across the app.
        </p>
      </div>

      {/* NotebookCell */}
      <Section
        title="NotebookCell"
        description="The core building block of the notebook. Combines a dark code editor with an output area. Supports idle, running, done, and error states. Run code with the play button or Cmd+Enter."
      >
        <p className="text-xs text-muted-foreground">Static states:</p>

        <NotebookCell
          index={1}
          code={`console.log("done state")`}
          output="done state"
          status="done"
          isFirst
          readOnly
        />

        <NotebookCell
          index={2}
          code={`throw new Error("something went wrong")`}
          output="ReferenceError: something went wrong"
          status="error"
          readOnly
        />

        <NotebookCell
          index={3}
          code={`await new Promise(r => setTimeout(r, 2000))`}
          status="running"
          readOnly
          isLast
        />

        <p className="text-xs text-muted-foreground pt-2">Live — try editing and running:</p>
        <LiveCellDemo />

        <PropTable
          rows={[
            ['index', 'number', 'Cell number shown in the header badge'],
            ['code', 'string', 'The source code displayed in the editor'],
            ['output', 'string?', 'Text output shown below the editor'],
            [
              'status',
              "'idle'|'running'|'done'|'error'",
              'Controls border color and run button state',
            ],
            ['isFirst / isLast', 'boolean?', 'Disables the move up / move down buttons'],
            ['readOnly', 'boolean?', 'Prevents editing the code textarea'],
            ['onCodeChange', '(code: string) => void', 'Called on every keystroke in the editor'],
            ['onRun', '() => void', 'Called when play button or Cmd+Enter is pressed'],
            ['onDelete', '() => void', 'Called when the trash icon is clicked'],
            ['onMoveUp / onMoveDown', '() => void', 'Called when the arrow buttons are clicked'],
          ]}
        />
      </Section>

      {/* Badge */}
      <Section
        title="Badge"
        description="Compact inline label for conveying status or category. Four semantic color variants map to common states: neutral, success, warning, and error."
      >
        <div className="flex flex-wrap gap-2">
          <Badge label="Default" color="default" />
          <Badge label="Success" color="success" />
          <Badge label="Warning" color="warning" />
          <Badge label="Error" color="error" />
        </div>
        <PropTable
          rows={[
            ['label', 'string', 'Text content of the badge'],
            [
              'color',
              "'default'|'success'|'warning'|'error'",
              'Controls background and text color',
            ],
          ]}
        />
      </Section>

      {/* StatCard */}
      <Section
        title="StatCard"
        description="Metric display card for dashboards. Shows a label, a large numeric value, and an optional delta line (trend vs previous period)."
      >
        <div className="flex flex-wrap gap-3">
          <StatCard label="Total Students" value="1,284" delta="+12% this week" />
          <StatCard label="Courses" value="48" />
          <StatCard label="Completion Rate" value="73%" delta="+5% vs last month" />
        </div>
        <PropTable
          rows={[
            ['label', 'string', 'Small label shown above the value'],
            ['value', 'string', 'Primary metric — large bold number'],
            ['delta', 'string?', 'Optional trend line shown in green below the value'],
          ]}
        />
      </Section>

      {/* CodeTag */}
      <Section
        title="CodeTag"
        description="Inline monospace snippet for displaying short commands or code references inside prose or UI labels."
      >
        <div className="flex flex-wrap gap-2">
          <CodeTag>pnpm install</CodeTag>
          <CodeTag>pnpm dev</CodeTag>
          <CodeTag>git commit -m "feat"</CodeTag>
        </div>
        <PropTable rows={[['children', 'string', 'The code text to display']]} />
      </Section>
    </div>
  )
}
