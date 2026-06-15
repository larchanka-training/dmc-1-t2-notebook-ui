# Authentication & Persistence — Frontend

> Архитектурный документ. Реализованная модель авторизации и хранения данных для JS Notebook (ui). Соответствует TARDIS-15.
>
> Frontend реализует двухшаговый email+OTP flow с JWT access/refresh токенами.
> Реализация PR #44 синхронизирована с backend TARDIS-75 OTP request/verify и
> refresh/logout endpoints (`POST /auth/otp/request`,
> `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`),
> Bearer-based `GET /auth/me` и Bearer-protected
> `/api/v1/notebooks[...]` endpoints (полный backend cutover завершён;
> `notebookClient` отправляет `Authorization: Bearer <access>` на все
> CRUD-операции). Backend error envelope — единый.

## Содержание

1. [Цели и контекст](#1-цели-и-контекст)
2. [Login flow (email → OTP)](#2-login-flow-email--otp)
3. [Хранение токенов](#3-хранение-токенов)
4. [XSS defence-in-depth](#4-xss-defence-in-depth)
5. [Refresh flow](#5-refresh-flow)
6. [Auth wall и роутинг](#6-auth-wall-и-роутинг)
7. [Multi-tab sync](#7-multi-tab-sync)
8. [Session lifecycle](#8-session-lifecycle)
9. [Notebook persistence (IndexedDB)](#9-notebook-persistence-indexeddb)
10. [Autosave](#10-autosave)
11. [Reload behaviour](#11-reload-behaviour)
12. [Sync с сервером](#12-sync-с-сервером)
13. [Версионирование](#13-версионирование)
14. [Local / dev / test режим OTP](#14-local--dev--test-режим-otp)
15. [Биометрия (future)](#15-биометрия-future)
16. [Migration note](#16-migration-note)
17. [Open questions](#17-open-questions)

---

## 1. Цели и контекст

- Простая авторизация по email + OTP. Никаких сторонних OAuth.
- Полный офлайн-режим для редактирования: ноутбуки живут в IndexedDB.
- Sync с бэком — после авторизации. После TARDIS-75 cutover все
  `/api/v1/notebooks[...]` endpoints требуют `Authorization: Bearer <access>`;
  placeholder `X-User-Id` на backend больше не работает на этих роутах.
- Защита от XSS — `localStorage` для токенов с многослойной защитой контента.

См. парный документ в API repo: [docs/auth.md][api-auth].

### 1.1. Текущий статус реализации TARDIS-75

На текущих feature branches реализован и синхронизирован первый контрактный
срез OTP auth:

- Backend OpenAPI содержит `POST /api/v1/auth/otp/request`,
  `POST /api/v1/auth/otp/verify`, `POST /api/v1/auth/refresh` и
  `POST /api/v1/auth/logout`;
- Backend `/api/v1/notebooks[...]` endpoints перешли на Bearer JWT
  (TARDIS-75 cutover); `get_current_user` на backend дополнительно
  сверяет, что сессия не отозвана/не истекла и принадлежит пользователю
  из `sub` — поэтому access-token, выпущенный до logout, перестаёт
  открывать notebook CRUD сразу, а не через 15 минут до своего `exp`;
- `ui/openapi/auth.openapi.yaml` hand-port’нут из backend snapshot;
- `ui/src/shared/api/generated/openapi-ts/auth.d.ts` перегенерирован;
- shared API facade вызывает `requestOtp(...)` / `verifyOtp(...)`;
- `notebookClient` отправляет `Authorization: Bearer <access>` на все
  CRUD-операции;
- shared error parser понимает backend envelope `{ error: { code, message,
fields } }`.

Ещё не завершено:

- UI screen/state миграция на двухшаговый OTP flow;
- backend rate limiting / OTP attempt counter / cleanup jobs.

Production OTP email delivery — реализовано через
[Resend](https://resend.com) (`RESEND_API_KEY`, `EMAIL_FROM`), см.
[API repo: docs/auth.md §12][api-auth]. Контракт ответа
`/auth/otp/request` (200 с `otp` в dev, 204 без `otp` в prod, §14)
не изменился.

---

## 2. Login flow (email → OTP)

Двухшаговая форма на `/login`:

```
┌──────────────────────────────┐
│  Step 1: Email                │
│  ┌────────────────────────┐  │
│  │ user@example.com       │  │
│  └────────────────────────┘  │
│  [Send code]                  │
└────────────┬─────────────────┘
             │ POST /auth/otp/request
             ▼
┌──────────────────────────────┐
│  Step 2: OTP                  │
│  Code sent to user@... (60s) │
│  ┌────────────────────────┐  │
│  │ _ _ _ _ _ _            │  │
│  └────────────────────────┘  │
│  [Verify]   [Resend in 45s]  │
└────────────┬─────────────────┘
             │ POST /auth/otp/verify
             ▼
       /notebooks (redirect)
```

**Поведение:**

- На step 1 кнопка `Send code` блокируется при `invalid email`.
- На step 2 поле — 6 раздельных input (или один с маской `------`).
- `Resend in 45s` — UI-таймер (5 мин TTL OTP, после 45 сек разрешён повтор; запрос ограничен серверным rate limit, см. [API repo: docs/auth.md §11][api-auth]).
- На `401 invalid_otp` — inline-ошибка `Invalid code`, поле фокусится.
  Текущий backend первым MVP-срезом использует этот же `error.code` для
  отсутствующего, истёкшего или уже использованного OTP.
- На `429 too_many_otp_requests` — пользователь слишком часто запрашивает OTP
  для этого email; UI остаётся на step 1/2 и предлагает попробовать позже.
- На `429 too_many_otp_attempts` — текущий OTP инвалидирован после слишком
  большого числа неверных попыток; UI возвращает пользователя к запросу нового
  кода.
- На future `401 otp_expired` — сообщение `Code expired, request a new one`,
  возврат на step 1. Если backend начнёт отдавать отдельный код, UI contract
  и generated types обновляются в том же PR.
- При успехе — токены кладутся в `localStorage`, `user` — в `userAtom`, navigate → `/notebooks` (или `from`-route, см. §6).

**Error envelope:** backend ошибки приходят в единой форме:

```json
{
  "error": {
    "code": "invalid_otp",
    "message": "Invalid or expired OTP",
    "fields": {}
  }
}
```

UI не должен читать `code` / `message` из верхнего уровня ответа. Общий parser
в `src/shared/api/errors.ts` разворачивает `error.code` в `ApiError.code`.

---

## 3. Хранение токенов

### 3.1. Где

| Ключ в `localStorage`  | Назначение                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `session.accessToken`  | JWT (HS256), TTL 15 мин. Используется в `Authorization: Bearer <...>`.  |
| `session.refreshToken` | Opaque string, TTL 30 дней. Используется только в `POST /auth/refresh`. |
| `session.user`         | Кэш текущего `User` (id, nullable email, nullable displayName, roles).  |

Reatom-атомы (`ui/src/entities/session/model/session.ts`):

```ts
export const accessTokenAtom = atom<string | null>(null, 'session.accessToken').extend(
  withLocalStorage({ key: 'session.accessToken', subscribe: false }),
)

export const refreshTokenAtom = atom<string | null>(null, 'session.refreshToken').extend(
  withLocalStorage({ key: 'session.refreshToken', subscribe: false }),
)

export const userAtom = atom<User | null>(null, 'session.user').extend(
  withLocalStorage({ key: 'session.user', subscribe: false }),
)

// Становится true после первого завершения loadCurrentUserAction (успех или ошибка).
// AuthRouteGuard ждёт этого флага перед редиректом, чтобы не выбрасывать пользователя
// при корректных токенах, когда user ещё не загружен из /auth/me.
export const sessionRestoredAtom = atom(false, 'session.restored')
```

> `subscribe: false` — `withLocalStorage` не регистрирует storage-listener сам; кросс-табовая синхронизация выполняется вручную в `setup.ts` (см. §7).

### 3.2. Почему localStorage, а не cookie

| Опция             | Pro                                                                             | Contra                                                                    |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `localStorage`    | Простой sync с Reatom, не требует CORS-настроек cookie, не требует CSRF-токенов | Уязвимо к XSS (если он есть)                                              |
| `httpOnly` cookie | Иммунно к JS-XSS                                                                | Требует CSRF-защиту, CORS-настройки, sticky-домен с api, сложнее SPA-flow |
| `in-memory`       | Иммунно к XSS                                                                   | Теряется при reload — для каждой вкладки заново вводить OTP. Неприемлемо. |

Выбрано `localStorage` + **многослойная защита от XSS** (см. §4). Не существование XSS — это контракт всего приложения, а не один защитный слой.

### 3.3. Security trade-off для MVP

Для MVP `refreshToken` хранится в `localStorage`, потому что это упрощает SPA-flow, локальную разработку и интеграцию с Reatom. Это осознанный security trade-off: при XSS токены могут быть прочитаны JavaScript-кодом. Риск снижается через sandbox исполнения пользовательского JS, sanitization markdown, CSP, запрет внешних скриптов и refresh-token rotation. Перед production/SaaS запуском решение нужно пересмотреть в сторону HttpOnly Secure SameSite cookie или другого server-controlled механизма хранения refresh token.

---

## 4. XSS defence-in-depth

> Хранение токенов в `localStorage` означает, что любой XSS = угон сессии. Поэтому контракт «никакого XSS» защищён несколькими независимыми слоями.

### 4.1. Слой 1 — изоляция пользовательского JS

Code-cells выполняются **только в Web Worker + QuickJS sandbox** (`ui/src/features/notebook/runtime/`, фасад `runtime/workerHost.ts`). Никогда — в основном потоке UI. Это уже архитектурное требование проекта (см. `docs/project.md` § Выполнение кода). Любая регрессия этого слоя — critical bug.

### 4.2. Слой 2 — санитизация Markdown

Text-cells = Markdown. Рендеринг — через библиотеку с включённой санитизацией (например, `react-markdown` с `rehype-sanitize`). **Никогда** не использовать `dangerouslySetInnerHTML` с пользовательским контентом. Никаких inline `<script>`, `on*=` атрибутов, `javascript:` URL.

### 4.3. Слой 3 — Content Security Policy

CSP-заголовок, настроенный в `proxy/nginx.conf`:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
img-src 'self' data:;
connect-src 'self' https://api.notebook.com;
frame-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
report-to csp-endpoint;
```

Пояснения к директивам:

- `frame-src 'self'` — sandboxed iframe для `display({ type: 'html' })` рендерится через `srcDoc` (см. `OutputFrame.tsx`), а не через `blob:`/`URL.createObjectURL`. `srcDoc`-документ наследует CSP родителя и несёт собственный inline-`<meta>` CSP (`default-src 'none'`), поэтому `blob:` в `frame-src` не нужен.
- `worker-src 'self' blob:` — sandbox исполняется в Web Worker (`runtime/worker.ts`), загружаемом Vite-бандлом; `blob:` нужен для worker-чанка. Без этой директивы runtime сломается молча.
- `style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` вынужденный из-за Tailwind 4 и shadcn (inline style-атрибуты в runtime). При возможности заменить на nonce-подход.
- `img-src 'self' data:` — без `https:`. Широкое `https:` разрешает любые сторонние картинки (tracking-pixels, exfiltration). Если в проде появится легитимный источник (CDN аватаров, превью и т. п.) — добавляем конкретный host, не весь `https:`.
- `font-src 'self' data:` — shadcn и любые иконочные шрифты через data-URI не упадут. CDN-шрифтов не используем.
- `connect-src` — только свой API. LLM-вызовы идут через бэкэнд, не с фронта.
- `report-to csp-endpoint` — включает reporting CSP-нарушений в проде. Endpoint и `Report-To`-хедер настраиваются в nginx. Без него регрессии CSP (сломанный fetch, заблокированный скрипт) не видны пока пользователь не жалуется.
- **Dev-режим.** Vite HMR требует `'unsafe-eval'` в `script-src` и `ws://` (или `wss://`) в `connect-src`. Приведённый выше полиси — prod. Dev-полиси формируется отдельно и НЕ должна попасть в prod-bundle.

**Перед прод-деплоем** CSP обязательно прогнать через [CSP Evaluator](https://csp-evaluator.withgoogle.com/) или эквивалент. Полиси выше — базовый набросок, он может потребовать подстройки под реальный бандл.

> CSP — это backend/infra-задача, отдельный тикет.

#### Cross-origin isolation (COOP/COEP)

Runtime прерывает зависший QuickJS VM через `SharedArrayBuffer` (Stop / Stop All без потери scope). `SharedArrayBuffer` доступен только в cross-origin isolated контексте, поэтому нужны заголовки:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

В dev они выставляются Vite-плагином (`vite.config.ts`), в prod — nginx (`proxy/`). Важное следствие: `require-corp` блокирует любой cross-origin ресурс без `Cross-Origin-Resource-Policy` / CORS — все сторонние ресурсы (шрифты, картинки, API) должны это учитывать. Без isolation runtime деградирует к fallback `worker.terminate()` (Stop теряет shared scope, но остаётся корректным).

### 4.4. Слой 4 — output-санитизация выводов code-cell

`console.log(...)`, `result` и `error` рендерятся как **текст** — никакой интерпретации HTML в этих item'ах.

**Исключение — `display({ type: 'html', value })`.** Этот API намеренно рендерит произвольный пользовательский HTML в изолированном `<iframe sandbox="allow-scripts">` (`OutputFrame.tsx`). Модель безопасности:

- **Гарантии.** `sandbox` без `allow-same-origin` даёт iframe уникальный origin: нет доступа к `localStorage`/cookies/DOM родителя и к токенам. Inline-`<meta>` CSP в `srcDoc` (`default-src 'none'`) блокирует сеть (fetch/XHR/WebSocket/beacon, удалённые скрипты), разрешая только inline script/style и data:/blob: картинки — самодостаточные визуализации работают, эксфильтрация — нет.
- **Ограничения (важно).** Скрипты в iframe живут в браузерном lifecycle iframe, а НЕ в QuickJS-рунтайме: кнопка Stop, timeout ячейки и output-бюджет их не контролируют. Есть best-effort heartbeat-watchdog (сносит зависший iframe), но это не эквивалент Stop. UI показывает постоянное красное предупреждение рядом с таким выводом. Это accepted risk MVP.

### 4.5. Слой 5 — нет внешних скриптов

Никаких `<script src="https://cdn..."/>`. Все зависимости через npm и Vite-bundle. Если нужны CDN-импорты (типа `d3` для пользовательских ноутбуков) — они только внутри sandboxed iframe code-cell, не в основном document.

### 4.6. Если XSS всё-таки случился

Слои 1–5 проектируются так, чтобы взлом одного не давал доступ к токенам. Но если ничего из этого не помогло — серверный refresh rotation (см. [API repo: docs/auth.md §5.3][api-auth]) обнаружит reuse и отзовёт все сессии пользователя.

---

## 5. Refresh flow

### 5.1. Когда обновляем

- **Reactive**: получили `401 unauthorized` на любой API-запрос → попытка refresh → retry оригинальный запрос.
- **Proactive (опционально)**: за 60 сек до `exp` access-токена. Парсим `exp` из JWT (без верификации, только для UX-таймера) и планируем background refresh.

### 5.2. Single-flight

Несколько одновременных 401 могут запустить параллельные `/auth/refresh`. Это сломает rotation: первый refresh инвалидирует второй. Решение — **single-flight pattern**:

```ts
let refreshInFlight: Promise<void> | null = null

async function refreshOnce(): Promise<void> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}
```

Все вызывающие 401-handler ждут одного и того же promise. После его resolve — повторяют свой исходный запрос с новым access.

### 5.3. Failure

- `401 invalid_refresh` / `refresh_revoked` / `refresh_expired` → `logout()` (см. §8), navigate → `/login?reason=session_expired`.

### 5.4. Где живёт

Рекомендуемое место — в `ui/src/shared/api/client.ts` (`openapi-fetch` middleware). Перехватывает 401 на любом из клиентов (`authClient`, `notebookClient`).

---

## 6. Auth wall и роутинг

### 6.1. Правила

| Путь                                          | Без авторизации                 | С авторизацией          |
| --------------------------------------------- | ------------------------------- | ----------------------- |
| `/login`                                      | OK                              | redirect → `/notebooks` |
| `/`                                           | redirect → `/login`             | redirect → `/notebooks` |
| `/notebooks`, `/notebooks/:id`, `/about`, ... | redirect → `/login?from=<path>` | OK                      |

«Авторизован» = `accessTokenAtom() !== null` **и** `userAtom() !== null`.

При первой загрузке `setup.ts` запускает `loadCurrentUserAction`, который:

1. Если токен есть — вызывает `GET /auth/me` и заполняет `userAtom`.
2. При `401` — чистит сессию (`clearSession()`).
3. В любом случае — устанавливает `sessionRestoredAtom = true`.

`AuthRouteGuard` ждёт `sessionRestoredAtom`, чтобы не редиректить пользователя с валидным токеном, у которого `session.user` отсутствовал в `localStorage` (eviction, миграция).

### 6.2. Гостевого режима нет

Никаких локальных ноутбуков для незалогиненного пользователя. Если в будущем потребуется — добавим красный баннер «без логина изменения будут стёрты при закрытии вкладки». В v1 — auth wall.

### 6.3. Реализация

`AuthRouteGuard` (`ui/src/app/ui/AuthRouteGuard.tsx`) — `reatomComponent`-обёртка вокруг защищённого контента. Логика:

- `sessionRestoredAtom = false` + токен есть, но `userAtom = null` → показывает `null` (skeleton), ждёт restore.
- `sessionRestoredAtom = true` + не авторизован → `window.location.replace('/login?from=<path>')`.
- Авторизован → рендерит `children`.

---

## 7. Multi-tab sync

`localStorage` шарится между вкладками. Нужно реагировать на изменения из других вкладок.

```ts
window.addEventListener('storage', (e) => {
  if (e.key === 'session.accessToken' && e.newValue === null) {
    clearSession()
    // navigate to /login если не там
  }
})
```

**Сценарии:**

- Logout в вкладке A → вкладка B видит `e.newValue === null` → выкидывает в `/login`.
- Refresh в вкладке A → вкладка B подхватывает новый access автоматически через Reatom + `withLocalStorage` (atom читает из localStorage при storage-event).

---

## 8. Session lifecycle

| Действие                  | Что происходит                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login (verify OTP)        | `setSession({ accessToken, refreshToken, user })` → запись в localStorage → navigate `/notebooks`.                                                                |
| Каждый API-запрос         | `Authorization: Bearer <accessToken>` через client middleware.                                                                                                    |
| 401 на запросе            | Single-flight refresh → retry (см. выше).                                                                                                                         |
| Refresh успешный          | Обновляются оба токена в `localStorage`.                                                                                                                          |
| Refresh неуспешный        | `clearSession()` → `localStorage.removeItem(...)` → `navigate('/login?reason=session_expired')`.                                                                  |
| Logout (кнопка)           | `POST /auth/logout` с текущим или stale/rotated `refreshToken` → backend отзывает session family, если она ещё активна → `clearSession()` → `navigate('/login')`. |
| Logout (в другой вкладке) | `storage` event → `clearSession()` → `navigate('/login')`.                                                                                                        |

---

## 9. Notebook persistence (IndexedDB)

### 9.1. Библиотека

**Dexie.js** — выбрано. Причины: типизированные query, миграции через `db.version()`, маленький overhead.

### 9.2. Схема БД

```ts
// ui/src/shared/lib/storage/db.ts (планируемое расположение)
import Dexie, { type Table } from 'dexie'

export interface LocalNotebook {
  id: string
  title: string
  formatVersion: number
  cells: LocalCell[]
  pendingDeletes: Tombstone[] // request-only tombstones, очищаются после успешного PATCH
  createdAt: number
  updatedAt: number
  deletedAt?: number // soft-delete всего ноутбука (не ячейки)
  dirty: boolean // не синхронизирован с сервером
  lastSyncedAt?: number
}

export interface Tombstone {
  id: string // id удалённой ячейки
  deletedAt: number // Unix timestamp milliseconds удаления
}

export interface LocalCell {
  id: string
  kind: 'code' | 'markdown'
  content: string
  updatedAt: number
}

class NotebookDB extends Dexie {
  notebooks!: Table<LocalNotebook, string>

  constructor() {
    super('notebook')
    this.version(1).stores({
      notebooks: 'id, updatedAt, dirty',
    })
  }
}

export const db = new NotebookDB()
```

### 9.3. Соответствие cell-моделей

Текущая Reatom-модель (`ui/src/features/notebook/domain/cell.ts`) использует **атомы внутри ячейки** (`code: Atom<string>`, `output: Atom<string>`, ...). При сериализации в IndexedDB:

- В IndexedDB пишем **plain JSON**: `{ id, kind, content, updatedAt }`. Output, status, viewMode — UI-state, не персистится.
- При загрузке из IndexedDB восстанавливаем атомы через `reatomCell(content, kind, id)`.

### 9.4. Поле `content` vs `code`

Текущая модель называет поле `code`. Сервер описывает поле `content`. **В новой версии формата** (`formatVersion: 1` со старта проекта) используем `content` — оно валидно и для code (JS-текст), и для markdown.

### 9.5. Dexie store versions

Dexie имеет собственный versioning для локальной базы (`db.version(N).stores(...)`). Это **разные вещи**:

- `db.version(N)` — версия схемы IndexedDB на конкретной машине. Меняется, когда мы добавляем/убираем indexes или stores.
- `formatVersion` в записи базы — версия контракта данных, общая с бэком.

Обе версии изменяются независимо. Рекомендация: в commit message явно указывать, какая именно версия поднимается.

Подробности о версионировании контракта данных — §13.

---

## 10. Autosave

### 10.1. Параметры

- Debounce: **`AUTOSAVE_DEBOUNCE_MS = 1000`** (константа в `ui/src/features/notebook/model/notebook.ts`).
- Триггер: любое изменение `cellsAtom` или `notebook.title`.

### 10.2. Алгоритм

```
[user types]
   │
   ▼
[debounce 1000 ms]
   │
   ▼
1. update cell.updatedAt = now()
2. update notebook.updatedAt = now()
3. db.notebooks.put(snapshot)         ← локальное сохранение
4. dirty = true
   │
   ▼
[если онлайн и авторизован]
   │
   ▼
5. PATCH /api/v1/notebooks/{id}
   │
   ▼
6. при success: dirty = false, lastSyncedAt = now()
```

Шаги 3 и 5 — независимы. Локальное сохранение завершается синхронно за дебаунсом. Server sync может упасть — это не блокирует пользователя.

### 10.3. UI-индикатор

- `Saved` — `dirty === false` и `lastSyncedAt` свежий.
- `Saving...` — есть in-flight PATCH.
- `Offline` — `navigator.onLine === false`, изменения есть.
- `Save failed` — последний PATCH упал, retry через экспоненциальный backoff.

---

## 11. Reload behaviour

При загрузке страницы ноутбука `/notebooks/:id`:

1. **Read local first.** `db.notebooks.get(id)` → если есть → рендерим немедленно.
2. **Pull from server in background.** `GET /api/v1/notebooks/:id`.
3. **Reconcile.** Сверяем локальную и серверную копии через LWW per-cell правила (см. §12.2), результат сохраняется в IndexedDB. `notebook.updatedAt` используется как freshness/sort hint, но не как lock и не как причина отклонять stale writes.
4. **Show.** UI обновляется новым state. Это может вызвать визуальный flash — допустимо.

Если локальной копии нет — показываем skeleton, ждём сервер, потом сохраняем в IndexedDB.

**Edge case:** пользователь набирал текст, упало соединение, перезагрузил вкладку. Локальный snapshot — последний после debounce 1000 мс. Текст, набранный за последнюю секунду — теряется. Это документированный trade-off.

---

## 12. Sync с сервером

> **Note:** доставка email (OTP-коды при логине, не sync) настраивается
> переменными `RESEND_API_KEY` / `EMAIL_FROM` на backend — см.
> [API repo: docs/auth.md §12][api-auth]. На контракт sync-эндпоинтов и
> на этот раздел не влияет.

### 12.1. Manual + Auto

- **Auto** — после autosave-debounce.
- **Manual** — кнопка `Sync now` в UI, форс-PATCH без ожидания debounce.

### 12.2. Conflict resolution

LWW per-cell + request-only tombstones. Алгоритм описан в [API repo: docs/auth.md §8][api-auth]. Клиент **всегда** присылает:

- полный массив `cells`,
- массив `deletedCells` (= текущее содержимое `pendingDeletes`).

Сервер делает merge и возвращает результат.

**Клиентская часть:**

- При ответе сервера на PATCH заменяем локальный state на серверный, перезаписываем IndexedDB.
- При успехе (HTTP 2xx) — `pendingDeletes = []` (очищаем буфер).
- При провале — `pendingDeletes` остаётся, повторяется на следующем sync.
- Если контракт PATCH возвращает только статус — делаем follow-up GET.

### 12.3. Удаление ноутбука

- Локально: `db.notebooks.update(id, { deletedAt: now(), dirty: true })`.
- Сервер: `DELETE /api/v1/notebooks/{id}`.
- При success: `db.notebooks.delete(id)` локально (cleanup).

### 12.4. Удаление ячейки

Request-only tombstones.

**Клиентский контракт:**

1. Пользователь нажимает «Delete» на ячейке.
2. Локально: ячейка убирается из `cellsAtom` + в `pendingDeletes` этого ноутбука добавляется `{ id, deletedAt: now() }`.
3. `notebook.dirty = true` → запускается autosave-debounce (§10).
4. При PATCH буфер присылается как `deletedCells` (см. §12.2).
5. При успехе PATCH — `pendingDeletes = []`.

**Edge cases:**

- Пользователь удалил ячейку и тут же (до PATCH) «отменил» через undo — убираем из `pendingDeletes` и возвращаем ячейку в `cellsAtom`.
- Ноутбук удалён целиком — `pendingDeletes` не трогаем, он удалится вместе с записью ноутбука.
- Повторное удаление того же `id` (два sync оффлайн, потом онлайн) — присылаем в PATCH несколько раз, сервер idempotent.

**Известное ограничение MVP:** если устройство B было оффлайн во время синка устройства A с удалениями и одновременно редактировало ту же ячейку **раньше** удаления на A, — ячейка «воскресает» при sync B. Полный фикс — server-side tombstones с TTL, отложен в v2.

---

## 13. Версионирование

Раздел собирает в одном месте всю информацию о версионировании на фронте: формат заметки, IndexedDB-схема, API, JWT. Парный раздел на бэке — [API repo: docs/auth.md «Версионирование»][api-auth].

### 13.1. Что версионируется

| Сущность                         | Схема версионирования                                                        | Где подробности                                   |
| -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Формат заметки (контракт данных) | `formatVersion: number` в каждой записи. Source of truth — бэк.              | §13.2–13.5, [API repo: docs/auth.md §9][api-auth] |
| API                              | URL-префикс `/api/v1`. При вводе `/v2` пишем новый клиент.                   | `ui/src/shared/api/`                              |
| IndexedDB схема                  | `db.version(N).stores(...)` Dexie. Изменяется при добавлении indexes/stores. | §9.5                                              |
| OpenAPI-типы                     | Перегенерируются из бэкендного `docs/openapi.json`.                          | `ui/src/shared/api/generated/`                    |

### 13.2. `MAX_SUPPORTED_FORMAT_VERSION`

Константа в `ui/src/features/notebook/domain/format.ts` (планируемое расположение):

```ts
export const MAX_SUPPORTED_FORMAT_VERSION = 1
```

- Это версия, на которую рассчитан код рендера и редактирования.
- Она **может отставать** от бэка между deploy-ами — это штатная ситуация.
- Инкрементируется вручную в PR, который добавляет поддержку новой версии формата.

Фронт никогда не инкрементирует `formatVersion` в PATCH-запросах. При сохранении ноутбука клиент возвращает то же значение `formatVersion`, что получил с сервера.

### 13.3. Что делать, если `notebook.formatVersion > MAX_SUPPORTED_FORMAT_VERSION`

Это происходит, когда бэк deployed новее фронта: бэк выдаёт данные в новом формате, старый фронт не умеет их полноценно рендерить.

Поведение: **строгий read-only режим ноутбука**.

#### Принцип

Никакие изменения, вызванные пользователем в этом режиме, НЕ сохраняются ни в IndexedDB, ни на backend. Гарантируем: открытие ноутбука в старом фронте не может сломать данные.

#### Что разрешено

| Действие                            | Доступно | Побочные эффекты                                                                                              |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Просмотр ячеек (`code`, `markdown`) | Да       | Чтение                                                                                                        |
| Копирование содержимого ячейки      | Да       | Без эффектов                                                                                                  |
| Run code-ячейки                     | Да       | Output в UI, не персистится (это поведение output в любом режиме, см. §9.3)                                   |
| Редактирование содержимого          | **Нет**  | Редактор в disabled-состоянии                                                                                 |
| Add cell                            | **Нет**  | Кнопка скрыта                                                                                                 |
| Delete / move cell                  | **Нет**  | Кнопки скрыты                                                                                                 |
| Save / autosave / sync              | **Нет**  | Автосейв отключён на уровне store, кнопки «Sync now» скрыты                                                   |
| Запись в IndexedDB                  | **Нет**  | Полученный с сервера ноутбук НЕ пишется в локальную базу; иначе после reload проблема воспроизведётся из кэша |

#### Unknown cell.kind

Ячейки с неизвестным фронту `kind` рендерятся как placeholder: «Ячейка типа X не поддерживается этой версией приложения». Run для них недоступен.

#### UI-индикация

- Наверху страницы — предупреждающий баннер: «Ноутбук в более новом формате (vN). Обновите приложение, чтобы редактировать.» Кнопка «Reload» делает `location.reload()` с cache bypass.
- Статус-индикатор autosave (§10.3) показывает «Read-only» вместо «Saved»/«Saving...».
- Все disabled-элементы сопровождаются tooltip’ом с объяснением.

#### Почему именно так

- **Почему не hard fail.** Пользователь должен видеть свои данные и мочь их скопировать. Hard fail выглядел бы как «мой ноутбук пропал» — это неприемлемо.
- **Почему не «временное редактирование в памяти».** Повышает риск, что пользователь потеряет работу (закрыл вкладку → всё пропало), и вызывает неявное поведение (кнопка Save выкл., а редактирование вкл. — зачем?). Лучше чёткий контракт: ничего не меняется, пока не обновите приложение.
- **Почему Run разрешён.** Run выполняет JS в sandbox; output НИКОГДА не персистится ни в IndexedDB, ни на бэке (§9.3). Риска повреждения данных нет, польза для пользователя есть.

### 13.4. Форвард-совместимость внутри одной версии

В пределах одного `formatVersion` клиент:

- **Игнорирует** неизвестные поля на ячейке и ноутбуке при чтении.
- **Сохраняет их** в IndexedDB вместе с известными (passthrough).
- **Возвращает их обратно** в PATCH-запросе без изменений.

Это позволяет бэку вводить опциональные поля без бампа версии, и фронт не разрушает данные других клиентов.

**Реализация:** TypeScript-типы из OpenAPI жёсткие, но в runtime при чтении и записи в IndexedDB храним **весь объект целиком**, а не только известные поля.

### 13.5. История версий

Полный список версий формата — в [API repo: docs/auth.md §9.6][api-auth]. На фронте не дублируем.

---

## 14. Local / dev / test режим OTP

### 14.1. Поведение

Определяется не frontend env-флагом, а ответом backend. В
`dev`/`local`/`test` backend возвращает `200 { otp, expiresAt }`; в
production-like env возвращает `204 No Content`.

### 14.2. UI

На экране ввода OTP (step 2) показываем баннер:

```
┌─────────────────────────────────────────┐
│  🛠  DEV MODE                            │
│  Your OTP: 123456    [Copy]              │
│  Expires at 10:05:00 UTC                 │
└─────────────────────────────────────────┘
```

**Реализация:** если `response.data?.otp` присутствует — рендерим баннер. `expiresAt` приходит от API как Unix timestamp в миллисекундах (`number`), а UI сам форматирует его в человекочитаемое время. Никаких отдельных env-флагов на фронте — просто проверяем поле в ответе. Это устойчивее к рассинхрону: prod-бэк никогда не вернёт `otp`, поэтому баннер не покажется даже если фронт случайно собран в dev-моде.

### 14.3. Безопасность

Баннер с OTP — **только** при наличии `otp` в ответе. Сервер защищён инвариантом «prod никогда не отдаёт otp» (см. [API repo: docs/auth.md §6][api-auth]). Дополнительные клиентские проверки избыточны.

---

## 15. Биометрия (future)

Не реализуется в v1. В session-модели зарезервируем место под `biometricEnabled: boolean` в `userAtom`. WebAuthn-flow добавится отдельным тикетом.

---

## 16. Migration note

OTP + JWT были в требованиях проекта с самого начала, но архитектурное решение
было готово позже стартового UI mock-flow. Текущее состояние миграции:

- `ui/openapi/auth.openapi.yaml` уже описывает `POST /auth/otp/request` и
  `POST /auth/otp/verify` в соответствии с backend snapshot;
- `ui/src/shared/api/generated/openapi-ts/auth.d.ts` перегенерирован;
- shared API facade уже имеет `requestOtp(...)` и `verifyOtp(...)`;
- `AuthResponse` остаётся facade alias на backend `OtpVerifyResponse`, чтобы
  не расширять refactor поверх контрактной синхронизации.

Осталось следующими шагами:

- заменить старый UI login screen на двухшаговый email → OTP flow;
- перевести session atoms с legacy `tokenAtom` на `accessTokenAtom` +
  `refreshTokenAtom`, если это ещё не сделано в текущей UI branch;
- подключить `requestOtp(...)` / `verifyOtp(...)` к форме;
- backend Bearer cutover для `/api/v1/notebooks[...]` **завершён**;
  включить полный authenticated sync lifecycle с Bearer headers на
  `notebookClient`.

---

## 17. Open questions

- **CSP**: точная политика согласовывается с backend/infra. Зафиксировано базовое предложение в §4.3.
- **Server-side tombstones**: request-only tombstones (§12.4) покрывают базовые сценарии. Редкое «воскрешение» ячеек при multi-device offline-edit — отложено в v2.
- **Конкретный markdown-рендерер**: `react-markdown` + `rehype-sanitize` рекомендован, но финальный выбор — при реализации.
- **Биометрия / WebAuthn**: отложено.

[api-auth]: https://github.com/larchanka-training/dmc-1-t2-notebook-api/blob/main/docs/auth.md
