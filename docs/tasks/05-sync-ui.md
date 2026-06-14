# Epic 05 — Sync UX (revision-based, на моках)

> **Статус (#130/#134/#135).** Реальный контракт синхронизации — **серверный LWW
> merge** через `POST`/`PATCH /api/v1/notebooks` (без отдельного `/sync`, без
> `If-Match`/`PUT`/409-диалога). Фоновый движок отправки описан в
> [`../architecture/remote-sync.md`](../architecture/remote-sync.md) и реализован
> в #134. Дизайн ниже (revision + `If-Match` + 409 `ConflictResolutionDialog`)
> — **исходный план на моках**, он устарел: конфликты решает сервер, фронт
> принимает слитый ответ как новую отправную точку.
>
> **#135 (реализован).** Первичная загрузка списка с сервера на входе,
> переключаемый слот (`activeNotebookIdAtom` вместо фиксированного
> `LOCAL_NOTEBOOK_ID`), открытие ноутбука из списка (open-into-slot), удаление
> с confirm-модалкой и sync-статус в топбаре (`SyncIndicator`: synced /
> syncing / offline / sync failed / «нужен повторный вход»). Это и есть текущий
> sync-UX; конкретные статусы — в коде (`ui/src/features/notebook/ui/SyncIndicator.tsx`,
> `model/remoteSync.ts` `RemoteSyncStatus`). Mock-план ниже сохранён как
> исторический контекст, не как контракт.

---

# ⚠️ Obsolete (mock-era plan) — superseded by #130/#134

Всё, что ниже, — **исходный mock-план** (revision / `If-Match` / `PUT` /
409-диалог). Он НЕ реализован и НЕ является текущим контрактом. Действующий
контракт — серверный LWW через `POST`/`PATCH` (см.
[`../architecture/remote-sync.md`](../architecture/remote-sync.md)). Не копировать
эти assumptions в #135 — раздел сохранён только как исторический контекст.

## Why

Дока обещает облачную синхронизацию, но:

- Стратегия конфликт-резолюции просто отсылает к ТЗ — ТЗ нет.
- Нет UI: пользователь не понимает, что синхронизировано, что нет, что в конфликте.
- В коде sync ещё не начат.

При этом эпик можно полностью реализовать **на моках** — MSW отдаёт фиктивный `revision`, конфликты симулируются по флагу. Это закрывает 80% работы и фиксирует контракт, на который потом ляжет реальный бэк.

Без sync пользователь не может работать с разных устройств — а это главное обещание SaaS-модели проекта.

## User stories

- Как пользователь, я всегда вижу состояние синхронизации текущего ноутбука: `synced` / `modified` / `syncing` / `conflict` / `offline`.
- Как пользователь, я нажимаю `Sync` и моя локальная версия уезжает в облако; если на сервере новее — я вижу diff и выбираю «mine» / «theirs» / «merge».
- Как пользователь, я работаю офлайн, после восстановления связи вижу баннер «You have N unsynced notebooks · Sync now».
- Как пользователь, я не теряю данные ни в одном из сценариев — даже при отмене конфликт-резолюции.

## Acceptance criteria

### Модель состояния

- [ ] У каждого ноутбука 4 поля sync-state: `serverRevision: number | null`, `localRevision: number`, `lastSyncedAt: string | null`, `status: SyncStatus`.
- [ ] `SyncStatus = 'pristine' | 'modified' | 'syncing' | 'conflict' | 'error'`.
- [ ] `pristine` = `localRevision === serverRevision`. `modified` = `localRevision > serverRevision`. `conflict` определяется только сервером в ответе на PUT.
- [ ] Любое изменение ноутбука инкрементирует `localRevision`.

### Online/offline

- [ ] Слушаем `navigator.onLine` + `online`/`offline` events. Глобальный атом `isOnlineAtom`.
- [ ] Offline-индикатор в шапке (иконка + tooltip «Working offline — changes will sync when back»).
- [ ] При переходе offline → online — авто-баннер «N notebooks pending sync · [Sync all]».

### Манул-sync

- [ ] В шапке открытого ноутбука — кнопка `Sync` со статусом-бейджем.
- [ ] Кнопка disabled при `pristine`, показывает spinner при `syncing`, badge `Conflict` при `conflict`.
- [ ] Push-flow: `PUT /notebooks/:id` с заголовком `If-Match: <serverRevision>`. На 2xx — обновляем `serverRevision`, статус = `pristine`.
- [ ] Pull-on-open: при открытии ноутбука, если `isOnline` и `lastSyncedAt` старше 5 мин — фоновый `GET /notebooks/:id`. Если `serverRevision > localRevision` и локальной модификации нет — тихо мерджим (replace). Если есть локальные правки и серверная revision выше — статус `conflict`.

### Конфликт-резолюция

- [ ] При 409 от PUT — открываем модалку `ConflictResolutionDialog`.
- [ ] Модалка показывает: список изменённых ячеек, для каждой 2 версии side-by-side (mine vs theirs).
- [ ] На каждую ячейку — radio: `Keep mine` / `Keep theirs`.
- [ ] Глобальные действия: `Keep all mine` / `Keep all theirs` / `Cancel`.
- [ ] После Apply — формируется merged-версия, PUT с `If-Match: <новой server revision>`, локально обновляются ячейки.
- [ ] Cancel — оставляет статус `conflict`, ничего не теряет.

### Auto-sync (опционально, за флагом)

- [ ] Настройка `notebookSettings.autoSync: boolean` (default `false` для MVP).
- [ ] Если включена и `isOnline` и `status === 'modified'` — авто-PUT через 5 с после последнего изменения (debounce).

### Список ноутбуков

- [ ] У каждого ноутбука в списке — sync-бейдж (`synced` / `modified` / `conflict` / `offline-only`).
- [ ] Глобальная кнопка `Sync all` (видна, когда есть хотя бы один `modified`).

### Гарантии безопасности

- [ ] Локальная копия не перетирается ни в одном сценарии до подтверждения пользователем (если он выбрал `theirs` в конфликте — тогда да).
- [ ] При ошибке сети sync завершается с `status: 'error'`, **локальные изменения не теряются**.
- [ ] Юнит-тест на race: одновременный edit + sync — corretto serializуется.

## Tech notes

### Файлы

```
src/features/sync/                  ← новая фича
  model/
    syncState.ts                    ← per-notebook sync atoms
    syncActions.ts                  ← push, pull, resolveConflict
    syncActions.test.ts
    online.ts                       ← isOnlineAtom
    conflict.ts                     ← merge utilities (cell-level diff)
    conflict.test.ts
  ui/
    SyncStatusBadge.tsx
    SyncButton.tsx
    ConflictResolutionDialog.tsx
    OfflineBanner.tsx
    PendingSyncBanner.tsx
  index.ts

src/shared/api/notebook.ts          ← +sync(id, body, ifMatch): {status: 200|409, ...}
openapi/notebook.openapi.yaml       ← + If-Match header, 409 response
src/app/mocks/handlers.ts           ← PUT с поддержкой If-Match
```

> **notebook теперь vendored (TARDIS-131):** правки контракта (If-Match/409 выше) идут в backend → `pnpm api:vendor` → `pnpm api:generate`, а не в удалённый `openapi/notebook.openapi.yaml`. См. `docs/architecture/api-layer.md`.

### Reatom

```ts
// sync-state хранится отдельно от самого ноутбука,
// чтобы edit-операции не триггерили лишних reactions в sync UI
notebookSyncAtoms: Map<notebookId, {
  serverRevision: Atom<number | null>
  localRevision:  Atom<number>
  lastSyncedAt:   Atom<string | null>
  status:         Computed<SyncStatus>
}>

isOnlineAtom: Atom<boolean>
pendingSyncAtom: Computed<NotebookSummary[]>   // status !== 'pristine'

pushNotebook  : Action(id)
pullNotebook  : Action(id)
syncAll       : Action()
resolveConflict: Action(id, decisions: Map<cellId, 'mine' | 'theirs'>)
```

### Контракт sync (через OpenAPI)

```yaml
/notebooks/{id}:
  put:
    parameters:
      - in: header
        name: If-Match
        required: true
        schema: { type: string } # "rev:<n>"
    requestBody:
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Notebook' }
    responses:
      '200':
        description: Updated
        headers:
          ETag: { schema: { type: string } } # новая server revision
      '409':
        description: Conflict
        content:
          application/json:
            schema:
              type: object
              properties:
                serverVersion: { $ref: '#/components/schemas/Notebook' }
                serverRevision: { type: integer }
```

### Conflict merge

V1: **cell-level**, не line-level.

- Маппим ячейки по `id` (а они у нас стабильные).
- Если в обеих версиях ячейка с тем же id, но разный `source` — это конфликт по ячейке.
- Удаления / добавления конфликтуют, если ячейка модифицирована/удалена с обеих сторон.
- Результат — массив `CellConflict[]`, передаётся в диалог.

CRDT (Yjs/Automerge) **не используем** — overkill для cell-level конфликтов, и формат тогда нужно проектировать с нуля. Если в будущем добавим коллаборацию в реальном времени — отдельный архитектурный эпик.

## Mock strategy

- **MSW** хранит `Map<notebookId, { notebook: Notebook, revision: number }>`.
- `PUT /notebooks/:id`:
  - читает `If-Match`, сравнивает с `revision`;
  - совпадает → `revision++`, 200 + новый ETag;
  - не совпадает → 409 + текущая серверная версия.
- Симуляция конфликта: `?simulate=conflict` query или в MSW dashboard кнопка «Make next PUT conflict» — для ручного тестирования диалога.
- Симуляция offline: переключатель в dev-overlay (`navigator.onLine` подменяется через `Object.defineProperty` в `src/app/devtools`).
- Симуляция сетевой задержки: MSW handler с `delay(1500)` для `syncing`-состояния.

## Out of scope

- Real-time коллаборация / OT / CRDT.
- Шифрование на клиенте (E2EE).
- Backfill истории версий (только текущая + последняя серверная).
- Push-уведомления о внешних изменениях.
- Селективный sync отдельных ячеек.

## Dependencies

- [Epic 02](./02-notebook-data-model.md) — нужен стабильный JSON-формат и id ячеек.
- [Epic 06](./06-auth-accounts.md) — sync имеет смысл только для авторизованного пользователя; для анонима выдаём подсказку «Sign in to sync».
- Желательно — [Epic 04](./04-notebook-management.md) для `Sync all` в списке.
