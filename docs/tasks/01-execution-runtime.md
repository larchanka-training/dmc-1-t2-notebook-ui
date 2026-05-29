# Epic 01 — Execution runtime

## Why

Сейчас код пользователя выполняется через `new Function(...)` прямо в основном потоке страницы (`src/features/notebook/model/executeJS.ts`). Это:

- **Небезопасно** — пользовательский код имеет доступ к `window`, `fetch`, `localStorage`, токенам.
- **Нет изоляции между ячейками** — переменная, определённая в ячейке 1, не видна в ячейке 2 (ломает Jupyter-подобный UX).
- **Нельзя прервать** — зацикленный код подвешивает вкладку.
- **Output — плоская строка** — графики, HTML, ошибки сваливаются в одно поле.
- **Нет executionCount** — невозможно определить порядок выполнения ячеек (а это ключ к воспроизводимости).

Цель — настоящий runtime, на котором можно дальше строить UX, LLM-генерацию и шеринг ноутбуков.

## User stories

- Как пользователь, я хочу, чтобы переменная из предыдущей ячейки была доступна в следующей — как в Jupyter.
- Как пользователь, я хочу остановить зациклившуюся ячейку одной кнопкой, не перезагружая страницу.
- Как пользователь, я хочу видеть отдельно stdout, ошибки, возвращённое значение и HTML/SVG-вывод.
- Как пользователь, я хочу видеть номер запуска ячейки `[1]`, `[2]`, чтобы понимать порядок.
- Как пользователь, я хочу сбросить runtime «как новый» одной кнопкой (Restart kernel).
- Как разработчик, я хочу быть уверен, что код пользователя не может прочитать мои auth-токены.

## Acceptance criteria

### Sandbox

- [x] Код выполняется в **Web Worker**, не в основном потоке.
- [x] Worker создан из бандла Vite (а не из строки) — корректно типизирован и проходит CSP.
- [x] Из Worker недоступны `document`, `window`, `localStorage`, основной `fetch` к origin (тестируется юнит-тестом).
- [x] DOM-вывод (Canvas/SVG/HTML) рендерится в отдельный `<iframe sandbox="allow-scripts">` под ячейкой, общение через `postMessage`.

### Shared scope

- [x] Переменные, объявленные через `var`, `let`, `const`, `function` в ячейке N, доступны в ячейке N+1.
- [x] `Restart kernel` сбрасывает scope, статус всех ячеек и executionCount.
- [x] Удаление ячейки **не** удаляет её переменные из scope — Jupyter-семантика, чтобы избежать сюрпризов.

### Stop / Interrupt

- [x] Кнопка `Stop` в running-ячейке завершает выполнение в течение ≤ 500 мс.
- [x] После Stop статус ячейки = `interrupted`, output содержит явное «Execution interrupted by user».
- [x] `Stop All` в тулбаре ноутбука останавливает все выполняющиеся ячейки и очередь.

### Очередь

- [x] `Run All` ставит ячейки в очередь и выполняет последовательно, executionCount возрастает.
- [x] Если ячейка падает, очередь останавливается, остальные помечены как `skipped` с возможностью продолжить.

### Structured output

- [x] Output ячейки — массив, не строка. См. модель в Tech notes.
- [x] `console.log/warn/error/info` маршрутизируются в разные item-ы (`stdout` / `stderr`).
- [x] Последнее **expression statement** (как в REPL) попадает в `result` item.
- [x] Объекты сериализуются через структурированный клон-сейф формат (числа, строки, массивы, объекты до глубины 5 — далее `[Object]`), без `String(value)`.

### ExecutionCount

- [x] У каждой ячейки есть `executionCount: number | null` (null = не запускалась).
- [x] Бейдж `[3]` слева от ячейки.
- [x] Изменение содержимого ячейки **не сбрасывает** executionCount — обнуляет только Restart.

### Limits

- [x] Таймаут выполнения по умолчанию — 30 с, конфигурируется в `notebookSettings`.
- [x] По таймауту — статус `timeout`, output с явной отметкой.
- [x] Лимит размера output — 5 МБ, далее truncated с предупреждением.

> Все AC реализованы в рамках TARDIS-70 (Web Worker + persistent QuickJS
> kernel). Shared scope несёт функции/классы/замыкания через персистентный
> VM; Stop использует `SharedArrayBuffer`-interrupt (с fallback на terminate
> вне cross-origin isolation).

## Tech notes

> **Статус Tech notes.** Раздел приведён к фактической реализации
> TARDIS-70. Где исходный план разошёлся с кодом — указано явно.

### Файлы

```
src/features/notebook/
  runtime/
    worker.ts          ← entrypoint Web Worker, владеет persistent QuickJS-ядром
    workerHost.ts      ← клиентский фасад: singleton worker, timeout, SAB-interrupt, respawn
    quickjs.ts         ← createKernel(): sandbox-ядро на quickjs-emscripten-core
    transform.ts       ← acorn AST-rewrite top-level деклараций в globalThis-слоты
    serialize.ts       ← безопасная сериализация значений (глубина 5)
    interrupt.ts       ← worker-side SharedArrayBuffer-флаг прерывания
    limits.ts          ← DEFAULT/MIN/MAX timeout + clamp
    outputBudget.ts    ← лимит 5 МБ, measureItemBytes (общий для kernel и host)
    types.ts           ← HostMsg/WorkerMsg, OutputItem, SerializedValue, статусы
  model/
    notebook.ts        ← CRUD ячеек (cellsAtom)
    runtime.ts         ← Reatom-модель: статус, очередь, executionCount, run/stop/restart
    notebookSettings.ts← timeoutMsAtom
  ui/
    NotebookCell.tsx   ← Stop button, [n] badge, рендер OutputItem[]
    OutputView.tsx     ← рендерит массив OutputItem в порядке исполнения
    OutputFrame.tsx    ← sandboxed iframe для display(html) + heartbeat-watchdog
    NotebookToolbar.tsx← Run All / Stop All / Restart kernel
```

`executeJS.ts` удалён — модели исполняют код через `workerHost.runInWorker`.

### Worker-протокол (фактический)

```ts
// host → worker
type HostMsg =
  // Однократно после создания worker'а (только в cross-origin isolated):
  // передаёт SAB, первый int32 которого — флаг прерывания.
  | { kind: 'init'; interruptBuffer: SharedArrayBuffer }
  | { kind: 'run'; runId: string; code: string; timeoutMs: number }

// worker → host
type WorkerMsg =
  | { kind: 'output'; runId: string; item: OutputItem } // стримятся по мере появления
  | { kind: 'done'; runId: string; status: RuntimeStatus }

type RuntimeStatus = 'done' | 'error' | 'timeout' | 'interrupted'

type OutputItem =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'result'; value: SerializedValue }
  | { type: 'error'; name: string; message: string; stack?: string }
  | { type: 'html'; html: string } // рендерится в sandboxed iframe
  | { type: 'image'; mime: string; data: string } // base64
```

Ключевое отличие от исходного плана: состояние не идёт через postMessage. VM
**persistent**: один `QuickJSContext` живёт всю жизнь worker'а, scope хранится
внутри VM — нет ni `cellId`, ni `execCount`, ni host-снапшота scope в протоколе.

**Interrupt (Stop):** кооперативный через `SharedArrayBuffer`-флаг +
`vm.runtime.setInterruptHandler` — заблокированный VM прерывается **без**
уничтожения worker'а, scope выживает. Fallback вне cross-origin isolation
(нет SAB) и по timeout — `worker.terminate()` + respawn (scope теряется).
For parked promise (`await new Promise(() => {})`) есть host-side watchdog
(≈250 мс), чтобы Stop укладывался в ≤500 мс.

### Shared scope

Код ячейки исполняется в async-IIFE внутри persistent QuickJS VM. Top-level
декларации (`const/let/var/function/class`) переписываются через **acorn AST**
в присваивания `globalThis.<name>` (см. `transform.ts`), без локального
binding — один слот на имя. Поэтому ячейка N+1 видит переменные ячейки N
нативно, а повторный запуск `const x = 1` — это ре-присваивание, не
redeclaration. `with (__ctx)` НЕ используется (не пишет `var/let/const` в \_\_ctx).
`import`/`export`/`import(...)`/`import.meta` отклоняются с читаемой ошибкой
(`new.target` — разрешён).

### Reatom-модель

```ts
runtimeStatusAtom: Atom<'idle' | 'busy'>
execCounterAtom: Atom<number>   // монотонный счётчик
queueAtom: Atom<string[]>       // cellId[]
skippedCellsAtom: Atom<string[]> // для Continue после skip-on-error
runCell / runAll / resumeQueue / stopCell / stopAll / restartKernel: Action
```

Все async actions обязаны оборачивать внутренние await-границы в `wrap(...)` —
иначе под production `clearStack()` (`src/setup.ts`) continuation после
`await` падает с `missing async stack`, и `runtimeStatusAtom` залипает в `busy`.
React-хендлеры тоже всегда обёрнуты `wrap`. Реакция UI — `reatomComponent` +
`cell.status()`, `cell.output()`.

### Тесты

- `quickjs.test.ts` — capture console, errors, timeout/interrupt/budget,
  изоляция, shared scope, display(), инкрементальный `onItem`-стриминг.
- `transform.test.ts` — AST-rewrite деклараций, trailing expression,
  отклонение import/export, `new.target`.
- `workerHost.test.ts` / `workerHost.di.test.ts` — round-trip, timeout+respawn,
  output budget, shared scope, DI-фабрика worker'а.
- `serialize.test.ts`, `limits.test.ts`, `outputBudget.test.ts`,
  `interrupt.test.ts` — юниты нейтральных модулей.
- `runtime.test.ts` / `runtime.restart.test.ts` / `runtime.repro.test.ts` —
  executionCount, очередь, skip-on-error, stop/restart, и регресс на
  async-stack (`wrap` под `clearStack()`).
- `runtime.acceptance*.test.ts` — трассировка AC через публичный API.
- `OutputView.test.tsx` / `OutputFrame.test.tsx` / `NotebookView.test.tsx` —
  порядок вывода, heartbeat-watchdog iframe, RTL-интеграция.

## Mock strategy

Runtime — **не мок**, это реальный код. Здесь нет HTTP-зависимостей.

Для unit-тестов используем `vitest` + JSDOM. Worker в тестах подменяется через DI: `runtime.ts` принимает фабрику `() => WorkerLike`, в проде — Vite `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`, в тестах — синхронный inline-host.

## Out of scope

- ESM-импорт из CDN (esm.sh) — отдельный эпик.
- TypeScript-транспиляция пользовательского кода — позже, поверх runtime.
- Сохранение outputs в JSON ноутбука и их восстановление — закрывает [Epic 02](./02-notebook-data-model.md).
- Hotkeys (`Shift+Enter`) — [Epic 03](./03-cell-editing-ux.md).

## Dependencies

Нет. Это нижний слой, на котором стоит всё остальное.
