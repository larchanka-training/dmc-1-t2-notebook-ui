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

### Файлы

```
src/features/notebook/
  runtime/                            ← новая папка
    worker.ts                         ← entrypoint Web Worker
    workerHost.ts                     ← клиентский фасад, postMessage-протокол
    types.ts                          ← message types, OutputItem, RuntimeStatus
    serialize.ts                      ← безопасная сериализация значений
    runtime.test.ts                   ← unit-тесты протокола и сериализации
  model/
    notebook.ts                       ← runCell идёт через workerHost
    runtime.ts                        ← Reatom-модель: статус runtime, очередь, executionCount
  ui/
    NotebookCell.tsx                  ← Stop button, [n] badge, рендер OutputItem[]
    OutputView.tsx                    ← новая, рендерит массив OutputItem
    OutputFrame.tsx                   ← iframe для DOM-вывода
```

`executeJS.ts` удаляется после миграции (модели меняют импорт на `workerHost.run`).

### Worker-протокол (минимум)

```ts
// host → worker
type HostMsg =
  | { kind: 'run'; cellId: string; code: string; execCount: number; timeoutMs: number }
  | { kind: 'interrupt'; cellId: string }
  | { kind: 'reset' }

// worker → host
type WorkerMsg =
  | { kind: 'output'; cellId: string; item: OutputItem }
  | { kind: 'done'; cellId: string; status: 'done' | 'error' | 'timeout' | 'interrupted' }

type OutputItem =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'result'; value: SerializedValue }
  | { type: 'error'; name: string; message: string; stack?: string }
  | { type: 'html'; html: string } // рендерится в iframe
  | { type: 'image'; mime: string; data: string } // base64
```

Interrupt реализуется через **`worker.terminate()` + создание нового worker'а**, в который перезапускается тот же shared-scope state (хранится в host-снапшоте). Это просто, дёшево и переживёт `while(true)`.

### Shared scope

В Worker заводим единый async-IIFE контекст, исполняем код ячейки через `new Function('__ctx', ...)` где `__ctx` хранит назначения. Объявления (`const x = ...`) перехватываем минимальной трансформацией: префиксом `with (__ctx)` или AST-обёрткой через `acorn` (предпочтительно, надёжнее). Решение об AST vs `with` — отдельный спайк ≤ 4 ч.

### Reatom-модель

```ts
runtimeStatusAtom: Atom<'idle' | 'busy'>
execCounterAtom: Atom<number> // монотонный счётчик
queueAtom: Atom<string[]> // cellId[]
runCell: Action(id)
runAll: Action()
stopCell: Action(id)
stopAll: Action()
restartKernel: Action()
```

Все `Action` async — используют `wrap` для `postMessage`-RTT. Реакция UI — `reatomComponent` + `cell.status()`, `cell.output()`.

### Тесты

- `runtime.test.ts` — happy path, stderr, error, timeout, interrupt (с искусственным `while(true)`), reset.
- `notebook.test.ts` (расширить) — executionCount монотонно растёт, restart его обнуляет, runAll выстраивает очередь.

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
