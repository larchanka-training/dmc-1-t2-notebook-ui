# Epic 04 — Notebook management

## Why

Сейчас в проекте есть **один** активный ноутбук (атом `cellsAtom`). Нет страницы списка, нет CRUD-UI, нет навигации между ноутбуками. Файл `NotebookListPanel.tsx` удалён в текущей ветке — нужно полноценно перепроектировать.

Без управления коллекцией:

- Пользователь не может работать с двумя темами в одной сессии.
- Невозможно протестировать sync (нечего синхронизировать).
- Нечего показывать на главной странице после логина.

## User stories

- Как пользователь, я хочу видеть список своих ноутбуков с превью и датой обновления.
- Как пользователь, я хочу создать, переименовать, дублировать и удалить ноутбук.
- Как пользователь, я хочу разложить ноутбуки по папкам/тэгам.
- Как пользователь, я хочу найти ноутбук по названию или по содержимому.
- Как пользователь, я хочу видеть, какой ноутбук открыт прямо сейчас, и быстро переключаться.

## Acceptance criteria

### Список

- [ ] Страница `/notebooks` отображает список всех ноутбуков пользователя.
- [ ] Каждый item: title, updatedAt (relative — «2 hours ago»), счётчик ячеек, превью первых N символов первой code-ячейки.
- [ ] Сортировка: `updatedAt desc` по умолчанию, alt — `title asc`, `createdAt desc`.
- [ ] Empty state: «No notebooks yet — Create your first».
- [ ] Skeleton-loader при первом чтении из IndexedDB / API.

### CRUD

- [ ] **Create** — кнопка `+ New notebook` в шапке списка. Создаётся пустой ноутбук с дефолтным title `Untitled notebook N`, открывается в редакторе.
- [ ] **Rename** — inline-редактирование title в шапке открытого ноутбука + в карточке списка через context-menu.
- [ ] **Duplicate** — глубокая копия ноутбука (новый id, title с суффиксом `(copy)`).
- [ ] **Delete** — с confirm-диалогом. После удаления — toast «Notebook deleted · Undo» в течение 10 с.

### Sidebar / навигация

- [ ] В левом сайдбаре — список последних 10 ноутбуков с активным выделением текущего.
- [ ] `Cmd/Ctrl+P` — quick-open модалка с фуззи-поиском по title.

### Папки и тэги

- [ ] У ноутбука поле `tags: string[]` и `folderId: string | null`.
- [ ] В сайдбаре — дерево папок (макс. глубина 3). Drag-and-drop ноутбука между папками.
- [ ] CRUD папок: create / rename / delete (delete с confirm — освобождает ноутбуки, не удаляет их).
- [ ] Фильтр по тэгу в списке (chip-фильтры сверху списка).

### Поиск

- [ ] Поле `Search notebooks` над списком.
- [ ] Ищет по title и по `source` всех ячеек (через индекс — см. Tech notes).
- [ ] Подсвечивает в превью совпавшую часть.
- [ ] Debounce 200 мс.

### Роутинг

- [ ] `/notebooks` — список (default landing после логина).
- [ ] `/n/:id` — открытый ноутбук.
- [ ] `/n/:id/cell/:cellId` (опционально) — deep-link с автоскроллом к ячейке.
- [ ] Несуществующий `:id` — 404-страница «Notebook not found · Back to list».

## Tech notes

### Файлы

```
src/pages/
  notebooks/                       ← новая страница (список)
    index.ts
    ui/NotebookListPage.tsx
    model/notebookList.ts          ← переехал из features
  notebook/                        ← существующая, добавить 404-фоллбэк

src/features/notebook/
  model/
    notebookList.ts                ← удалить (переезжает в pages/notebooks)
    notebookCrud.ts                ← новый: create/rename/duplicate/delete actions
    folders.ts                     ← новый: CRUD папок
    quickOpen.ts                   ← новый: fuzzy state
  ui/
    NotebookCard.tsx               ← карточка в списке
    NotebookListSidebar.tsx        ← recent list в app sidebar
    FolderTree.tsx
    QuickOpenDialog.tsx
    DeleteNotebookDialog.tsx

src/shared/lib/storage/
  notebooks.ts                     ← + методы по тэгу/папке (см. Tech notes)
  folders.ts                       ← новый object store
```

### Reatom

```ts
notebooksListAtom: Atom<NotebookSummary[]> // только метаданные
foldersAtom: Atom<Folder[]>
searchQueryAtom: Atom<string>
filteredListAtom: Computed<NotebookSummary[]>
activeNotebookIdAtom: Atom<string | null> // привязан к URL через reatomRoute
```

`NotebookSummary` = `{ id, title, updatedAt, cellCount, firstCellPreview, tags, folderId }` — лёгкая структура для списка, без выгрузки полного ноутбука в память.

### Роутинг

Используем `reatomRoute` / `urlAtom` (см. AGENTS.md: react-router-dom в проекте запрещён). Добавляем routes в `src/app/routes.ts` (или туда, где сейчас лежат — проверить при разработке).

### Поиск

- v1: linear scan in-memory по уже загруженным summary (быстро при ≤ 500 ноутбуков, реально достаточно для MVP).
- v2 (если будет нужно): построение инвертированного индекса по словам в Web Worker.

### Список из IndexedDB

`notebooks.list()` отдаёт только summary-проекции через `IDBIndex` по `updatedAt`. Полный ноутбук читается только в момент открытия `/n/:id`. Это держит RAM ограниченной даже при тысячах ноутбуков.

## Mock strategy

- **IndexedDB** — реальное хранилище (см. [Epic 02](./02-notebook-data-model.md)).
- **MSW handlers**:
  - `GET /notebooks` — отдаёт seed (3–5 примеров) при первом запуске, далее in-memory store.
  - `POST /notebooks` — создаёт в моке + возвращает с `id`.
  - `PATCH /notebooks/:id` — title/tags/folderId, обновляет `updatedAt`.
  - `DELETE /notebooks/:id` — soft-delete (флаг), чтобы тестировать «Undo».
  - `GET /folders` / `POST /folders` / `DELETE /folders/:id`.
- OpenAPI: добавить `Folder`, `NotebookSummary`, `UpdateNotebookRequest`. После — `pnpm api:generate`, тонкие фасады в `@/shared/api/notebooks.ts`, `@/shared/api/folders.ts`. _(notebook-схемы теперь приходят из бэкенда: изменить контракт → `pnpm api:vendor` → `pnpm api:generate`; см. `docs/architecture/api-layer.md`.)_

## Out of scope

- Шеринг по ссылке / публичные ноутбуки.
- Sync с сервером (только локальный CRUD + моки) — [Epic 05](./05-sync-ui.md).
- Permissions / роли владельца / co-editor.
- Trash bin с TTL (сейчас только инлайн-undo 10 с).
- Bulk-операции (выделение нескольких ноутбуков сразу).

## Dependencies

- [Epic 02](./02-notebook-data-model.md) — формат и IndexedDB обязательны.
- Желательно — [Epic 06](./06-auth-accounts.md) хотя бы в зачаточном виде, чтобы было понятие «мои ноутбуки».
