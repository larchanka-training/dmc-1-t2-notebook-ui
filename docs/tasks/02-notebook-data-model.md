# Epic 02 — Notebook data model & persistence

## Why

Сегодня ноутбук живёт **только в Reatom-атомах в памяти** — при перезагрузке вкладки всё теряется. В доке проекта обещается «офлайн через IndexedDB», но это не реализовано.

Дополнительно — модель противоречива:

- Дока использует `type: "code" | "text"`.
- Реализация — `kind: "code" | "markdown"`.
- Сериализованного формата ноутбука нет вовсе.
- Нет `schemaVersion` — любая будущая миграция (например, добавление shared-scope-metadata, executionCount, outputs) будет ломающей.

Эпик закладывает **версионируемый persistent-формат** и **локальный store**, на которые опираются все последующие эпики (sync, шеринг, .ipynb-импорт).

## User stories

- Как пользователь, я не теряю ноутбук при перезагрузке вкладки.
- Как пользователь, я работаю с ноутбуком офлайн — изменения сохраняются автоматически.
- Как пользователь, я открываю ноутбук и вижу outputs, которые были в момент последнего запуска (если шарят ссылку — тоже видит).
- Как разработчик, я могу выкатить новую версию формата без поломки уже сохранённых ноутбуков.

## Acceptance criteria

### Формат

- [ ] У каждого ноутбука есть `schemaVersion: number` (текущая — `1`).
- [ ] Поля JSON: `id`, `schemaVersion`, `title`, `createdAt`, `updatedAt`, `cells[]`, `settings?`.
- [ ] У каждой ячейки: `id`, `kind: 'code' | 'markdown'`, `source: string`, `executionCount: number | null`, `outputs: OutputItem[]` (из [Epic 01](./01-execution-runtime.md)), `metadata?: Record<string, unknown>`.
- [ ] Терминология **единая везде**: `kind`, не `type`; `markdown`, не `text`; `source`, не `content`/`code`. OpenAPI (`openapi/notebook.openapi.yaml`) приводится к этой же терминологии.
- [ ] JSON-схема валидируется (Zod) при чтении из IndexedDB и при импорте.

### Миграции

- [ ] Есть массив `migrations: Record<from, (json) => json>` в `src/features/notebook/persistence/migrations.ts`.
- [ ] При чтении ноутбука неизвестной версии — миграция последовательно до текущей.
- [ ] При чтении версии > текущей (пользователь откатил клиент) — показываем явную ошибку «ноутбук создан в новой версии».
- [ ] Юнит-тест прогоняет миграцию с фикстурой `v0 → v1` (даже если v0 пока синтетический — задаём паттерн).

### Persistence

- [ ] Локальный store — IndexedDB через **`idb`** (~1 КБ, без overhead Dexie; решено в Tech notes ниже).
- [ ] Schema БД: object store `notebooks` (key = `id`), индекс по `updatedAt`.
- [ ] CRUD API в `src/shared/lib/storage/notebooks.ts`: `get(id)`, `list()`, `put(notebook)`, `delete(id)`, `clear()`.
- [ ] При первом запуске без ноутбуков — создаётся seed-ноутбук «Welcome» (из текущего `SEED_CODE`).

### Autosave

- [ ] При изменении `cells`/`title`/`outputs` ноутбук сохраняется в IndexedDB через **debounce 500 мс**.
- [ ] Сохраняем **только если есть реальные изменения** (по deep-equal либо по dirty-флагу).
- [ ] Индикатор в шапке: `Saved · 12:34:01` / `Saving…` / `Save failed — retry`.
- [ ] Сохранение outputs — да, по умолчанию. Опт-аут в `settings.persistOutputs = false`.

### Загрузка

- [ ] При открытии страницы `/n/:id` — модель сначала пытается прочитать ноутбук из IndexedDB.
- [ ] Если нет — фоллбэк к `notebookApi.get(id)` (через MSW).
- [ ] Skeleton/loader пока идёт чтение.

### Совместимость со схемой

- [ ] `openapi/notebook.openapi.yaml`: `Cell` обновлён до новой формы. Generation чистый.
- [ ] `@/shared/api/notebook` экспортирует `type Notebook` и `type Cell` идентично доменной модели — никакого ручного преобразования в `features/`.

## Tech notes

### Файлы

```
src/features/notebook/
  domain/
    cell.ts                     ← существующий, переименовать поля → source/kind
    notebook.ts                 ← новый: тип Notebook, конструктор reatomNotebook
  persistence/
    schema.ts                   ← Zod-схемы NotebookV1, CellV1
    migrations.ts               ← { 0: v0_to_v1 }, плюс applyMigrations(json)
    persistence.test.ts
  model/
    notebook.ts                 ← перевести cellsAtom → reatomNotebook(id)
    autosave.ts                 ← дебаунс + запись в storage
    autosave.test.ts
src/shared/lib/storage/
  db.ts                         ← openDB('js-notebook', 1, …) через idb
  notebooks.ts                  ← CRUD над object store
  notebooks.test.ts
```

### Почему `idb`, а не Dexie

- Dexie ~50 КБ, тащит свой query-DSL — нам не нужен.
- `idb` (~1 КБ) — тонкая Promise-обёртка над нативным API, читаемо и тривиально мокается в тестах через `fake-indexeddb`.
- Если позже понадобятся индексы/range-query (поиск, [Epic 04](./04-notebook-management.md)) — `idb` справится; миграция на Dexie остаётся опцией.

### Reatom-модель

```ts
// доменная модель — без атомов на ячейке, см. ниже
export interface Notebook {
  id: string
  schemaVersion: 1
  title: Atom<string>
  cells: Atom<Cell[]>
  updatedAt: Atom<string>
  settings: Atom<NotebookSettings>
}

export const reatomNotebook = (initial: NotebookJSON): Notebook => { ... }
```

**Важное решение**: атомы на ячейке (текущий подход в `domain/cell.ts`) сохранять сложно — приходится снапшотить вручную. Делаем плоские POJO-ячейки, а реактивность — через `cellsAtom: Atom<Cell[]>` и иммутабельные обновления. Это упрощает сериализацию, диффы для sync и тесты.

### Autosave

```ts
const dirty = computed(() => /* hash of cells + title */, 'notebook.dirty')

onConnect(dirty, async (ctx) => {
  // debounce 500ms, then notebooksStore.put(serialize(notebookAtom()))
})
```

Сериализация — чистая функция `toJSON(notebook): NotebookJSON`. Никаких side-effects, тестируется отдельно.

### OpenAPI

`Cell` приводится к:

```yaml
Cell:
  type: object
  required: [id, kind, source]
  properties:
    id: { type: string }
    kind: { type: string, enum: [code, markdown] }
    source: { type: string }
    executionCount: { type: integer, nullable: true }
    outputs:
      type: array
      items: { $ref: '#/components/schemas/OutputItem' }
    metadata: { type: object, additionalProperties: true }
```

После правки — `pnpm api:generate`, обновить `@/shared/api/notebook.ts` (фасадные типы должны просто реэкспортировать сгенерированные).

## Mock strategy

- IndexedDB — **реальный**, не мок. В тестах подменяется на `fake-indexeddb/auto`.
- MSW-handler `GET /notebooks/:id` возвращает либо seed-ноутбук, либо in-memory копию (хранится в `src/app/mocks/store.ts`).
- MSW-handler `PUT /notebooks/:id` принимает payload, кладёт в свой in-memory store, возвращает с новым `updatedAt`. Используется в [Epic 05](./05-sync-ui.md).

## Out of scope

- Sync с сервером, конфликт-резолюция — [Epic 05](./05-sync-ui.md).
- Список ноутбуков, поиск, папки — [Epic 04](./04-notebook-management.md).
- Импорт `.ipynb` — [Epic 08](./08-quality-and-dx.md).
- Шаринг по ссылке.

## Dependencies

- Для полноценного `outputs` — нужен [Epic 01](./01-execution-runtime.md) (он определяет `OutputItem`). Эпики 01 и 02 можно вести параллельно, согласовав `OutputItem` контракт первым шагом.
