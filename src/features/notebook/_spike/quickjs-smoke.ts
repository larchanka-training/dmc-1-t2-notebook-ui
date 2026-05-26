// SPIKE — TARDIS-70. Temporary file. To be removed before merging the
// feature branch. Pure QuickJS smoke test, no Worker yet.
import { getQuickJS } from 'quickjs-emscripten'

export interface SmokeResult {
  ok: boolean
  output: string
  isolation: {
    window: string
    document: string
    fetch: string
    localStorage: string
  }
  timedOut?: boolean
}

export async function runSmoke(code: string, timeoutMs = 1000): Promise<SmokeResult> {
  const QuickJS = await getQuickJS()
  const vm = QuickJS.newContext()
  const lines: string[] = []
  const isolation = {
    window: 'unknown',
    document: 'unknown',
    fetch: 'unknown',
    localStorage: 'unknown',
  }

  try {
    // Inject console.log
    const consoleHandle = vm.newObject()
    const logFn = vm.newFunction('log', (...args) => {
      const parts = args.map((arg) => {
        const dumped = vm.dump(arg)
        return typeof dumped === 'string' ? dumped : JSON.stringify(dumped)
      })
      lines.push(parts.join(' '))
    })
    vm.setProp(consoleHandle, 'log', logFn)
    logFn.dispose()
    vm.setProp(vm.global, 'console', consoleHandle)
    consoleHandle.dispose()

    // Interrupt handler — deadline-based
    const deadline = Date.now() + timeoutMs
    vm.runtime.setInterruptHandler(() => Date.now() > deadline)

    // 1) Isolation probe
    for (const name of ['window', 'document', 'fetch', 'localStorage'] as const) {
      const r = vm.evalCode(`typeof ${name}`)
      if (r.error) {
        isolation[name] = `eval-error: ${JSON.stringify(vm.dump(r.error))}`
        r.error.dispose()
      } else {
        isolation[name] = vm.getString(r.value)
        r.value.dispose()
      }
    }

    // 2) User code
    const evalResult = vm.evalCode(`(async () => { ${code} })()`)
    if (evalResult.error) {
      const dumped = vm.dump(evalResult.error)
      evalResult.error.dispose()
      return {
        ok: false,
        output: `eval error: ${JSON.stringify(dumped)}`,
        isolation,
      }
    }
    // Resolve promise
    const promise = evalResult.value
    const resolved = vm.resolvePromise(promise)
    vm.runtime.executePendingJobs()
    const awaited = await resolved
    promise.dispose()
    if (awaited.error) {
      const dumped = vm.dump(awaited.error)
      awaited.error.dispose()
      const isInterrupt = String(dumped).includes('interrupted')
      return {
        ok: false,
        output: `runtime error: ${JSON.stringify(dumped)}`,
        isolation,
        timedOut: isInterrupt,
      }
    }
    awaited.value.dispose()
    return { ok: true, output: lines.join('\n'), isolation }
  } finally {
    vm.dispose()
  }
}
