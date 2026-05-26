// SPIKE — TARDIS-70. Manual browser check page. Mounted at /_spike/tardis-70.
// Will be removed together with the rest of _spike/ once the real runtime lands.
import { useState } from 'react'
import { runInSpikeWorker } from './spike-host'
import type { SmokeResult } from './quickjs-smoke'

const PRESETS: Array<{ name: string; code: string; timeoutMs?: number }> = [
  { name: '1 + 1', code: 'console.log(1 + 1)' },
  { name: 'isolation probe', code: 'console.log(typeof window, typeof document, typeof fetch)' },
  {
    name: 'top-level await',
    code: 'const v = await Promise.resolve(42); console.log(v)',
  },
  {
    name: 'throw',
    code: 'throw new Error("boom from sandbox")',
  },
  {
    name: 'infinite loop (timeout=300ms)',
    code: 'while(true){}',
    timeoutMs: 300,
  },
]

export default function SpikePage() {
  const [code, setCode] = useState(PRESETS[0].code)
  const [timeoutMs, setTimeoutMs] = useState(1000)
  const [result, setResult] = useState<SmokeResult | null>(null)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)

  const run = async () => {
    setRunning(true)
    setResult(null)
    setElapsed(null)
    const start = performance.now()
    try {
      const r = await runInSpikeWorker(code, timeoutMs)
      setElapsed(Math.round(performance.now() - start))
      setResult(r)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 font-sans">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">SPIKE — TARDIS-70</h1>
        <p className="text-sm text-muted-foreground">
          Manual browser smoke check for QuickJS-in-Worker. URL:{' '}
          <code className="rounded bg-muted px-1 py-0.5">/_spike/tardis-70</code>
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => {
              setCode(p.code)
              if (p.timeoutMs) setTimeoutMs(p.timeoutMs)
            }}
            className="rounded border bg-card px-3 py-1.5 text-xs hover:bg-muted"
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Code
        </label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={6}
          className="w-full rounded border bg-card p-3 font-mono text-sm outline-none focus:bg-muted/30"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">
          Timeout (ms):{' '}
          <input
            type="number"
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            className="ml-1 w-24 rounded border bg-card px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run in worker'}
        </button>
        {elapsed != null && (
          <span className="text-xs text-muted-foreground">elapsed: {elapsed} ms</span>
        )}
      </div>

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={
                'rounded px-2 py-0.5 text-xs font-medium ' +
                (result.ok
                  ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                  : 'bg-red-500/15 text-red-700 dark:text-red-400')
              }
            >
              {result.ok ? 'ok' : 'error'}
            </span>
            {result.timedOut && (
              <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
                host-terminated
              </span>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Output
            </p>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-3 font-mono text-sm">
              {result.output || <span className="text-muted-foreground">(empty)</span>}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Isolation (typeof inside sandbox)
            </p>
            <pre className="mt-1 rounded bg-muted p-3 font-mono text-sm">
              {JSON.stringify(result.isolation, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
