# Epic 07 — LLM code generation

## Why

«AI-генерация кода по описанию» — заявленная киллер-фича проекта. Сейчас в коде ничего нет. На моках можно сделать **полный фронт-флоу**:

- UX-контракт с пользователем (кнопка, индикатор, стриминг, ошибки).
- Контракт с бэком (request body, SSE chunks).
- Отдельная фича `features/llm`, не размазанная по `features/notebook`.

Без этого эпика проект остаётся «обычным in-browser REPL» и не выполняет своё обещание.

## User stories

- Как пользователь, я пишу в markdown-ячейке описание («Постройте график sin(x) на интервале 0..2π») и нажимаю `Generate code` — ниже появляется code-ячейка с кодом, который я могу запустить.
- Как пользователь, я хочу видеть код **по мере генерации** (стриминг), а не ждать молча 10 секунд.
- Как пользователь, я хочу отменить генерацию, если ответ идёт не туда.
- Как пользователь, я хочу, чтобы LLM учитывал код в предыдущих ячейках (контекст), — иначе она не знает, какие переменные у меня уже определены.
- Как пользователь, я хочу видеть аккуратную ошибку при таймауте/квоте, а не «Unknown error».

## Acceptance criteria

### Триггер

- [ ] В тулбаре markdown-ячейки (только когда `kind === 'markdown'` и `source.trim() !== ''`) — кнопка `Generate code` (иконка sparkles + label).
- [ ] Кнопка disabled, если: пустая ячейка, идёт другая генерация в этом ноутбуке, нет интернета.
- [ ] При клике — сразу вставляется новая code-ячейка ниже текущей со статусом `generating` и пустым source.

### Стриминг

- [ ] Запрос через **SSE** (Server-Sent Events) к `POST /llm/generate`.
- [ ] По мере прихода chunks — `source` ячейки растёт; пользователь видит, как код «печатается».
- [ ] Прогресс-индикатор (animated cursor `▍` в редакторе).
- [ ] По `done`-event — статус ячейки `idle`, executionCount не трогаем (ячейка ещё не запускалась).

### Отмена

- [ ] Кнопка `Cancel` появляется поверх ячейки во время генерации.
- [ ] На клик: `AbortController.abort()`, ячейка получает текущий накопленный source и статус `idle` (не удаляется — пользователь может доработать руками).
- [ ] Esc на сфокусированной ячейке = Cancel.

### Контекст

- [ ] В payload включаем `context` — последние **N=10** ячеек ноутбука с типом и source. Лимит общего размера контекста — 8 КБ (truncate с конца, если больше).
- [ ] Учитываем настройку `notebookSettings.llm.includeContext: boolean` (default `true`).

### Ошибки

- [ ] Сетевая ошибка → toast «Generation failed · Retry», ячейка переходит в `error` с заголовком и пустым source.
- [ ] 429 (rate limit) → toast «Limit reached · Try again in 1 min».
- [ ] 408/timeout (>30 с без chunks) → автоматический abort + toast.
- [ ] Любой response с safety-blocked content → user-friendly сообщение «Request was blocked by safety filter».

### Безопасность

- [ ] Сгенерированный код **не запускается автоматически** — пользователь явно нажимает Run.
- [ ] Если результат пустой / только пробелы — ячейка не вставляется, toast «No code generated».

### Видимость

- [ ] Если пользователь не залогинен — кнопка скрыта (или disabled с подсказкой «Sign in to use AI generation»). На моках всё равно работает, но баннер показывается, чтобы зафиксировать контракт.
- [ ] Глобальный indicator в шапке: «AI: N generations today» (на моках всегда `N/100`).

## Tech notes

### Файлы

```
src/features/llm/                   ← новая фича
  model/
    generate.ts                     ← Reatom action + SSE consumption
    generate.test.ts
    promptBuilder.ts                ← собирает контекст из соседних ячеек
    promptBuilder.test.ts
    activeGeneration.ts             ← Map<cellId, AbortController>
  ui/
    GenerateCodeButton.tsx
    CancelGenerationOverlay.tsx
    StreamingCursor.tsx
  index.ts
src/shared/api/llm.ts               ← postSSE-обёртка над fetch
openapi/llm.openapi.yaml            ← новый
src/app/mocks/handlers.ts           ← SSE handler
```

### SSE через fetch

`openapi-fetch` не подходит для SSE напрямую. Делаем тонкую обёртку:

```ts
export async function* generateStream(
  payload: GenerateRequest,
  signal: AbortSignal,
): AsyncGenerator<GenerateChunk, void, void> {
  const res = await fetch('/api/llm/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
  })
  if (!res.ok || !res.body) throw toApiError(res.status, await res.text())
  // парсим SSE: data: {"delta": "..."}\n\n
  // yield чанки до done
}
```

Использование:

```ts
export const generateCell = action(async (sourceCellId: string) => {
  const targetCell = await insertCellBelow(sourceCellId, 'code')
  const controller = new AbortController()
  activeGenerations.set(targetCell.id, controller)
  targetCell.status.set('generating')
  try {
    for await (const chunk of generateStream(buildPayload(sourceCellId), controller.signal)) {
      targetCell.source.set((s) => s + chunk.delta)
    }
    targetCell.status.set('idle')
  } catch (err) {
    if (controller.signal.aborted) return // отмена — OK
    targetCell.status.set('error')
    toast.error('Generation failed')
  }
}, 'llm.generate')
```

### Контракт OpenAPI (для документации, даже если транспорт — SSE)

```yaml
/llm/generate:
  post:
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required: [prompt]
            properties:
              prompt: { type: string, maxLength: 8000 }
              context:
                type: array
                items:
                  type: object
                  required: [kind, source]
                  properties:
                    kind: { type: string, enum: [code, markdown] }
                    source: { type: string }
              language: { type: string, enum: [javascript, typescript], default: javascript }
    responses:
      '200':
        description: text/event-stream — data lines as {"delta": "...", "done"?: true}
        content: { text/event-stream: {} }
      '429': { $ref: '#/components/responses/RateLimited' }
      '503': { description: Upstream unavailable }
```

### Reatom-замечания

- `activeGeneration` — НЕ атом, обычная in-memory `Map<cellId, AbortController>`. Контроллеры в атомах не имеют смысла.
- Обработчики в UI обязательно `wrap(...)` (strict async stack).
- Параллельные генерации в одном ноутбуке запрещены на уровне UI (кнопка disabled). В модели — мягкая защита (если запросили вторую — отменяем первую с toast).

### Лимиты

- Per-cell hard limit on accumulated `source`: 50 КБ (защита от рантового цикла «генерация бесконечного текста»).
- Total prompt size (request body): 16 КБ; при превышении — урезаем контекст с самой старой ячейки.

## Mock strategy

MSW-handler для `POST /llm/generate`:

- Возвращает `ReadableStream` со SSE-фреймами.
- Фейк-генерация: берём фикстуру кода (например, в зависимости от ключевых слов в `prompt`: содержит «график» → возвращает шаблон с d3/Chart.js; «массив» → код с примером сортировки; иначе — generic «const result = ...; console.log(result)»).
- Стримим по 5–10 символов с `setTimeout(50)` — имитирует токены.
- Симуляции:
  - `?simulate=rate-limit` → 429.
  - `?simulate=slow` → задержка 5 с перед первым чанком.
  - `?simulate=safety-block` → 200 + один data event `{"error": "safety_block"}`.
  - `?simulate=error-mid` → 200, начинает стримить, через 1 с обрывает connection.
- Dev-overlay (`src/app/devtools`) даёт кнопки переключения сценариев.

Это даёт полное покрытие фронта без единой реальной LLM-копейки.

## Out of scope

- Streamable explanation (LLM объясняет код после генерации).
- Multi-turn chat в ячейке.
- AI-автокомплит в редакторе.
- Inline-edit ячейки через AI («исправь эту ошибку»).
- Per-user квоты на бэке (UI-отображение есть, реальный счётчик — за бэком).
- Поддержка нескольких LLM-провайдеров на выбор в UI.

## Dependencies

- [Epic 02](./02-notebook-data-model.md) — ячейка должна иметь `source: string` (не `Atom<string>`), иначе стриминг превращается в кашу с реактивностью.
- [Epic 01](./01-execution-runtime.md) — желательно, чтобы пользователь сразу мог запустить сгенерированный код безопасно.
- [Epic 06](./06-auth-accounts.md) — желательно для квот «AI: N today».
