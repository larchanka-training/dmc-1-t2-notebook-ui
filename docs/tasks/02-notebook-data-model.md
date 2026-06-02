# Epic 02 — Notebook data model & persistence

> **Статус (TARDIS-72).** Локальная персистентность реализована: ноутбук
> переживает перезагрузку вкладки. Этот документ приведён в соответствие с
> кодом (AGENTS.md §9). Разделы ниже описывают **реализованное** состояние и
> явно помечают отложенное. Исходный план эпика был шире и местами расходился
> с тем, как уже устроен код, — устаревшие пункты переписаны под факт.

## Why

Раньше ноутбук жил **только в Reatom-атомах в памяти** — при перезагрузке
вкладки всё терялось. Теперь ноутбук сохраняется в IndexedDB и восстанавливается
при загрузке страницы.

Что заложено этим эпиком:

- **Версионируемый persistent-формат** (`formatVersion`) — основа для будущих
  миграций без поломки уже сохранённых ноутбуков.
- **Локальный store** на IndexedDB.
- Схема данных **выровнена с бэк-контрактом** (`api/docs/openapi.json`,
  `api/docs/auth.md` §7.2), чтобы будущий sync (Epic 05) лёг поверх без
  миграции формата.

Терминология `kind: 'code' | 'markdown'` уже была единой в коде и сохранена.

## User stories

- Как пользователь, я не теряю ноутбук при перезагрузке вкладки. ✅
- Как пользователь, я работаю с ноутбуком офлайн — изменения сохраняются
  автоматически (debounce-autosave). ✅
- Как разработчик, я могу выкатить новую версию формата без поломки уже
  сохранённых ноутбуков (скелет миграций + тест `v0 → v1`). ✅

Outputs **намеренно не персистятся** (см. раздел «Формат»), поэтому истории про
«вижу сохранённые outputs» в этом эпике нет — вывод воспроизводится повторным
запуском.

## Реализовано (TARDIS-72)

### Формат

Источник истины формата — `src/features/notebook/persistence/schema.ts`.

- [x] У ноутбука есть `formatVersion: number` (текущая — `1`). Имя выровнено
      с бэком (`format_version`), не `schemaVersion`.
- [x] `NotebookJSON`: `formatVersion`, `id`, `title`, `createdAt`, `updatedAt`,
      `cells[]`. Времена — **Unix epoch ms (`number`)**, как на бэке (не ISO).
- [x] `CellJSON`: `id` (UUID), `kind: 'code' | 'markdown'`, `content: string`,
      `updatedAt: number` (ms). Поле исходника — **`content`** (= бэк
      `CellSchema.content`); домен-атом остаётся `code`, mapping живёт в
      `toJSON`/`fromJSON`.
- [x] cell `id` — client-generated UUID через `newId()` (`crypto.randomUUID()`
      при наличии + UUID-shaped fallback для insecure origins; бэк ждёт
      `format: uuid`).
- [x] Валидация на границе — **ручной type-guard** `isNotebookJSON` /
      `assertNotebookJSON` (не Zod: лишняя зависимость для v1 не нужна; Zod
      окупится на импорте `.ipynb`).

**Outputs и `executionCount` НЕ персистятся** (решение TARDIS-72):

- вывод — эфемерный продукт прогона, воспроизводим повторным Run;
- `OutputItem` включает base64-`image` и `html` — хранить их раздуло бы
  storage без пользы;
- бэк outputs тоже не хранит — выравниваемся с контрактом.

`settings` и `metadata` в v1 не вводим — их добавит отдельная миграция, когда
появится потребитель.

### Миграции

`src/features/notebook/persistence/migrations.ts`.

- [x] `migrations: Record<number, (json) => json>` с `0: v0_to_v1` +
      `applyMigrations(raw)`.
- [x] Неизвестная старая версия — миграция последовательно до текущей.
- [x] Версия > текущей — явная ошибка «notebook created in newer version».
- [x] Юнит-тест на фикстуре `v0 → v1` (v0 синтетический, задаёт паттерн).

### Persistence

- [x] Локальный store — IndexedDB через **`idb`** («на вырост» под
      multi-notebook; см. Tech notes).
- [x] Схема БД: object store `notebooks` (key = `id`), индекс по `updatedAt`.
- [x] CRUD в `src/features/notebook/persistence/storage.ts`: `get(id)`,
      `list()`, `put(notebook)`, `putIfNewer(notebook, baseUpdatedAt)`,
      `remove(id)`, `clear()`. Чтение прогоняется через `applyMigrations` +
      валидатор.
- [x] `putIfNewer` — атомарный compare-and-swap в одной `readwrite`-транзакции
      IndexedDB. Это защита от silent overwrite между вкладками: stale-вкладка
      не может затереть более свежий ноутбук, сохранённый другой вкладкой.
- [x] При первом запуске без ноутбука — seed «Welcome» (из `SEED_CODE`)
      сохраняется в store.

Отличие от плана: метод `remove` (не `delete` — зарезервированное слово);
отдельного `db.ts` нет — `openDB` живёт в том же файле. Store лежит **внутри
слайса** (`features/notebook/persistence/storage.ts`), а не в `shared/lib`:
обёртка знает про `NotebookJSON` и гоняет доменные миграции, поэтому это
фич-код, а не generic-инфраструктура (правило слоёв — `shared` не зависит от
`features`).

### Autosave

`src/features/notebook/model/autosave.ts`.

- [x] При изменении `cells`/`title` — сохранение через **debounce 500 мс**.
- [x] Сохраняем только при реальных изменениях — через monotonic
      `notebookRevisionAtom`, без `JSON.stringify` всего notebook на каждый keypress.
- [x] Индикатор в шапке: `Saved · HH:MM:SS` / `Saving…` /
      `Save failed — retry` / `Changed in another tab — Reload / Save mine` /
      `Saved in a newer app version — update to edit this notebook`
      (`SaveIndicator`).
- [x] Cross-tab safety: после успешного save вкладка отправляет
      `BroadcastChannel`-событие; другие вкладки бесшовно подтягивают свежую
      версию, если у них нет локальных правок, или показывают conflict state,
      если локальные правки есть. При возврате во вкладку дополнительно
      проверяется IndexedDB (`focus` / `visibilitychange`), поэтому защита не
      зависит только от live-сообщений.
- [x] Overlapping saves внутри одной вкладки сериализованы: если пользователь
      редактирует во время pending write, текущий save записывает свой snapshot,
      а затем запускается второй save для новой dirty-версии. Clean baseline
      привязывается к реально записанному `NotebookJSON`, а dirty-детекция идёт
      по revision, не по mutable state после `await`.
- Опции `settings.persistOutputs` НЕТ — outputs не персистятся вообще (см.
  «Формат»).

### Загрузка

- [x] На старте приложения `loadNotebook` читает локальный ноутбук из
      IndexedDB; пусто — seed.
- [x] **Best-effort boot.** `loadNotebook` не реджектит ни на битом чтении,
      ни на упавшей первичной seed-записи (quota / private mode / blocked DB):
      любая ошибка хранилища глотается, seed остаётся в памяти. `setup.ts`
      запускает autosave в `finally`, поэтому отказ хранилища на старте не
      отключает автосейв на весь сеанс — следующая правка повторит запись
      и покажет `Save failed — retry`.
- [x] **Newer-format guard.** Если IndexedDB содержит notebook из более новой
      версии приложения, старый клиент не открывает его как «битый» и не пишет
      поверх. Выставляется `storageCompatibilityAtom = 'newer-format'`,
      autosave/overwrite блокируются, а UI показывает сообщение об обновлении.
- [x] **Loading-gate.** `NotebookPage` держит редактор за `Skeleton`, пока
      `notebookLoadedAtom` не станет `true` (выставляется в `finally` после
      boot-load — на любом исходе). Это закрывает race «сверхбыстрая правка до
      разрешения get будет затёрта восстановленными ячейками». `NotebookView`
      остаётся без гейта (и его тесты тоже).
- Маршрут `/n/:id` и фоллбэк к API/MSW — **отложены** (single-notebook MVP,
  см. «Out of scope»).

### Совместимость со схемой — отложено

Персистентный JSON уже выровнен по форме с бэк `CellSchema`/
`NotebookResponse`, но фронтовый `openapi/notebook.openapi.yaml` и
`@/shared/api/notebook` в этом тикете **не трогали** — это часть слоя
синка (Epic 05), где нужны `GET/PATCH {id}`, tombstones и ручной порт
контракта + `pnpm api:generate`.

## Tech notes

### Файлы (реализовано)

```
src/features/notebook/
  domain/
    cell.ts                     ← добавлены updatedAt: Atom<number> и uuid-id;
                                  поле исходника в домене осталось `code`
  persistence/
    schema.ts                   ← типы NotebookJSON/CellJSON + ручной валидатор
    schema.test.ts
    serialize.ts                ← чистые toJSON/fromJSON (mapping code↔content)
    serialize.test.ts
    migrations.ts               ← { 0: v0_to_v1 } + applyMigrations(raw)
    migrations.test.ts
    storage.ts                  ← openDB + CRUD + atomic putIfNewer CAS
    storage.test.ts
    crosstab.ts                 ← BroadcastChannel notifications for saved notebooks
    crosstab.test.ts
  model/
    notebook.ts                 ← cellsAtom + meta-атомы + loadNotebook + snapshot
                                  + notebookLoadedAtom (boot-gate) + baseUpdatedAt
                                  + storageCompatibilityAtom
    revision.ts                 ← O(1) dirty-signal for persisted notebook changes
    autosave.ts                 ← debounce + revision-based dirty tracking
                                  + saveStatusAtom + cross-tab guard + newer-format gate
    autosave.test.ts
  ui/
    SaveIndicator.tsx           ← индикатор Saved/Saving/Failed/Conflict/Outdated
    SaveIndicator.test.tsx
src/pages/notebook/ui/
  NotebookPage.tsx              ← loading-gate (Skeleton до notebookLoadedAtom)
  NotebookPage.test.tsx
```

Отличия от исходного плана: отдельного `domain/notebook.ts` с `reatomNotebook`
НЕТ (см. «Reatom-модель»); валидатор ручной, не Zod; storage — один файл
`persistence/storage.ts` (без отдельного `db.ts`), внутри notebook-слайса
(не в `shared/lib` — это фич-код, зависящий от доменных schema/migrations).

### Почему `idb`, а не Dexie

- Dexie ~50 КБ, тащит свой query-DSL — нам не нужен.
- `idb` — тонкая Promise-обёртка над нативным API, читаемо и тривиально
  мокается в тестах через `fake-indexeddb`.
- Выбран «на вырост» под multi-notebook + большие payload (индекс по
  `updatedAt`, range-query для поиска в [Epic 04](./04-notebook-management.md)).

### Reatom-модель (факт)

Исходный план предлагал перевести ячейки на плоские POJO и ввести
`reatomNotebook`. **Этот рефактор НЕ делался** — ячейка остаётся объектом
атомов (`domain/cell.ts`), реактивность — через `cellsAtom: Atom<Cell[]>`.
Персистентность решена без этого рефактора: чистый `toJSON` снапшотит атомы
ячейки в POJO, `fromJSON` пересобирает ячейки через `reatomCell`.

Метаданные ноутбука живут отдельными атомами в `model/notebook.ts`:
`notebookTitleAtom`, `notebookCreatedAtAtom`, `notebookLoadedAtom` (boot-gate),
плюс константа `LOCAL_NOTEBOOK_ID` (single-notebook MVP). Ячейка несёт
`updatedAt: Atom<number>`
(основа LWW), который бампится при редактировании содержимого, но НЕ при
перестановке (порядок — notebook-уровень, `api/docs/auth.md` §7.2).

### Autosave (факт)

Reatom v1001 не использует `onConnect` напрямую — применён паттерн
«subscribe + дебаунс-таймер» (как `startThemeSync` в `entities/theme` и `flush` в
`runtime.ts`):

- dirty-трекинг — через monotonic `notebookRevisionAtom` (`model/revision.ts`),
  без `JSON.stringify`/хэша всего notebook на каждый keypress. Ревизия бампится
  на edit исходника, структурных операциях (add/delete/reorder/change-kind),
  смене title и undo/redo; outputs/status/execution-count её НЕ трогают
  (не персистятся);
- `startAutosave()` подписывается на `notebookRevisionAtom`, каждое изменение
  (ре)армит `setTimeout(runSave, 500)`; первый синхронный emit пропускается
  (загрузка не должна сразу пересохранять). dirty определяется как
  `notebookRevisionAtom() !== savedRevisionAtom()` (`hasLocalChangesAtom`);
- `runSave` и все event-хендлеры (focus/visibilitychange, BroadcastChannel,
  кнопки индикатора) обёрнуты в `wrap` — таймер/событие это свежая
  async-граница, а в prod активен `clearStack()`;
- `saveStatusAtom` ведёт индикатор и имеет шесть состояний —
  `idle | saving | saved | error | conflict | outdated`: `error` —
  `QuotaExceededError`/блокировка БД (UI не падает), `conflict` — более свежая
  версия в другой вкладке, `outdated` — newer-format gate. `lastSavedAtAtom`
  хранит время последнего успешного save; при boot из сохранённого
  ноутбука `markBootRestored()` сразу показывает `Saved · <время>` по сохранённому
  `updatedAt`, не оставляя шапку пустой до первой правки.

Сериализация — чистые `toJSON`/`fromJSON` без side-effects, тестируются
отдельно.

### OpenAPI — отложено

`openapi/notebook.openapi.yaml` и `@/shared/api/notebook` в этом тикете не
трогали. Персистентный JSON уже выровнен по форме с бэк `CellSchema`
(`{id, kind, content, updatedAt}`), так что синк (Epic 05) сможет слать
ячейки без преобразования формата. Работа по контракту (ручной порт
`GET/PATCH {id}` + tombstones + `pnpm api:generate`) — в слое синка.

## Mock strategy

- IndexedDB — **реальный**, не мок. В тестах подменяется на
  `fake-indexeddb/auto` (подключён в `src/test/setup.ts`).
- MSW в проекте нет; моки `GET/PUT /notebooks/:id` — часть слоя синка
  ([Epic 05](./05-sync-ui.md)), не этого тикета.

## Out of scope

- Sync с сервером, конфликт-резолюция — [Epic 05](./05-sync-ui.md).
- Список ноутбуков, поиск, папки — [Epic 04](./04-notebook-management.md).
- Импорт `.ipynb` — [Epic 08](./08-quality-and-dx.md).
- Шаринг по ссылке.

## Dependencies

Персистентный формат хранит только `content`/`kind`/`updatedAt`, поэтому
от `OutputItem` (и следовательно от [Epic 01](./01-execution-runtime.md))
этот эпик больше не зависит — outputs не сериализуются. Синк с бэкендом
([Epic 05](./05-sync-ui.md)) опирается на уже выровненный здесь формат.
