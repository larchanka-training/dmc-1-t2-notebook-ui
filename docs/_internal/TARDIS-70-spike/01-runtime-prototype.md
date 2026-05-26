# Spike runtime prototype

Три взаимосвязанных файла, образующих минимальный «QuickJS-в-Worker'е»:

- `quickjs-smoke.ts` — чистая sandbox-функция, без Worker'а.
- `spike-worker.ts` — Web Worker entrypoint, оборачивает sandbox.
- `spike-host.ts` — host-фасад: lifecycle worker'а + timeout через
  terminate.

## `_spike/quickjs-smoke.ts`

Минимальный wrapper над `quickjs-emscripten`. Возвращает `SmokeResult` —
строковый `output` + флаг изоляции (`typeof window/document/...`
внутри VM). Делает три вещи:

1. Инжектит `console.log` в VM через `vm.newFunction`.
2. Ставит `setInterruptHandler` с deadline.
3. Eval'ит код в обёртке `(async () => { ... })()`, чтобы поддерживать
   top-level await; результат-promise резолвит через `vm.resolvePromise`.

```ts
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
```

### Замечания к коду (что переписываем для прода)

- `output: string` → `OutputItem[]` (структурированный, по AC эпика 01).
- `dispose` в `try/finally` хороший, но при early-return внутри try
  хендлы могут утечь (например, `evalResult.value` после ошибки в
  `evalResult.error` не освобождается). В проде — `Scope.withScope` или
  явный stack disposed-хендлов.
- `eval-error` отдельно от `runtime-error` — в проде объединяем в один
  `OutputItem` с типом `error`.
- `JSON.stringify(dumped)` — не безопасно для циклических. В проде —
  `serialize.ts` с глубиной 5 и fallback `[Object]`.

## `_spike/spike-worker.ts`

Worker entrypoint. Получает `{ runId, code, timeoutMs }`, вызывает
`runSmoke`, отвечает `{ runId, result }`.

```ts
// SPIKE — TARDIS-70. Web Worker entrypoint. Receives { code, timeoutMs }
// and sends back the SmokeResult from runSmoke().
import { runSmoke, type SmokeResult } from './quickjs-smoke'

interface RunMsg {
  kind: 'run'
  runId: string
  code: string
  timeoutMs: number
}

interface DoneMsg {
  kind: 'done'
  runId: string
  result: SmokeResult
}

self.onmessage = async (event: MessageEvent<RunMsg>) => {
  const { runId, code, timeoutMs } = event.data
  try {
    const result = await runSmoke(code, timeoutMs)
    const reply: DoneMsg = { kind: 'done', runId, result }
    self.postMessage(reply)
  } catch (err) {
    const reply: DoneMsg = {
      kind: 'done',
      runId,
      result: {
        ok: false,
        output: `worker exception: ${err instanceof Error ? err.message : String(err)}`,
        isolation: { window: '?', document: '?', fetch: '?', localStorage: '?' },
      },
    }
    self.postMessage(reply)
  }
}

export {} // ensure module scope
```

### Замечания

- В проде сообщения шире: помимо `done`, должны быть `output` (streaming
  для большого вывода).
- `try/catch` вокруг `runSmoke` — защита от того, что WASM не загрузился
  или произошла внутренняя ошибка quickjs-emscripten. Сохраняем в проде.

## `_spike/spike-host.ts`

Host-facade. Lazy singleton worker, timeout через `setTimeout` +
`terminate()` + respawn (зануляем `worker`, при следующем вызове
создастся заново). `runId` нужен, чтобы при будущих параллельных
вызовах не перепутать ответы.

```ts
// SPIKE — TARDIS-70. Host facade for the spike worker. Singleton worker,
// timeout via terminate + respawn.
import type { SmokeResult } from './quickjs-smoke'

interface RunMsg {
  kind: 'run'
  runId: string
  code: string
  timeoutMs: number
}

interface DoneMsg {
  kind: 'done'
  runId: string
  result: SmokeResult
}

let worker: Worker | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./spike-worker.ts', import.meta.url), { type: 'module' })
  return worker
}

function nextRunId(): string {
  return Math.random().toString(36).slice(2)
}

export async function runInSpikeWorker(code: string, timeoutMs = 1000): Promise<SmokeResult> {
  const w = ensureWorker()
  const runId = nextRunId()

  return new Promise<SmokeResult>((resolve) => {
    const timer = setTimeout(() => {
      w.removeEventListener('message', onMessage)
      w.terminate()
      worker = null
      resolve({
        ok: false,
        output: `host: terminated by timeout after ${timeoutMs}ms`,
        isolation: { window: '?', document: '?', fetch: '?', localStorage: '?' },
        timedOut: true,
      })
    }, timeoutMs + 100) // host timeout slightly above worker-side deadline

    const onMessage = (event: MessageEvent<DoneMsg>) => {
      if (event.data.runId !== runId) return
      clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      resolve(event.data.result)
    }
    w.addEventListener('message', onMessage)

    const msg: RunMsg = { kind: 'run', runId, code, timeoutMs }
    w.postMessage(msg)
  })
}
```

### Замечания

- `timeoutMs + 100` — host timeout чуть выше worker-side deadline,
  чтобы дать QuickJS-interrupt сработать первым (он дешевле, чем
  terminate+respawn). В проде — `terminate` остаётся как **финальный**
  страж на случай, если interrupt'ы не докрутили (например, нативная
  блокирующая операция в WASM).
- В проде нужна **сериализация** вызовов (на двойной клик Run в очереди
  ждать предыдущий). Сейчас — гонка: второй вызов получит ответ первого
  раньше, чем первый отпишется.
- `removeEventListener` обязательно — иначе при respawn worker'а
  слушатели на старый объект остаются висеть.

## Регистрация в `App.tsx`

Side-effect import в `ui/src/app/App.tsx:7`:

```tsx
import '@/features/notebook/_spike/spike-route'
```

Этот импорт удаляется одновременно с папкой `_spike/`.
