# Epic 06 — Auth & accounts (frontend)

## Why

Дока обещает «регистрация и вход (email/пароль или OAuth)», но:

- В UI есть только login-страница без реальных сценариев (verify email, reset password).
- Не описано, что происходит с локальными ноутбуками анонимного пользователя при первом логине — это распространённая UX-яма.
- Нет logout-сценария, refresh-токенов, защищённых маршрутов.

Эпик решает auth-стрелку **на фронтенде**, фиксирует контракты, и закрывает её на моках, чтобы остальные эпики (sync, ноутбуки «мои/чужие») могли уже опираться на «есть/нет user».

OAuth и реальная верификация почты — за бэком; фронт делает UI-флоу и закрывает его MSW-ответами.

## User stories

- Как новый пользователь, я могу зарегистрироваться по email/паролю, получить ссылку для verify email и зайти в продукт.
- Как пользователь, я могу залогиниться, выйти, остаться залогиненым между сессиями.
- Как пользователь, я могу восстановить пароль через email.
- Как пользователь, который работал офлайн без аккаунта, при первом логине я хочу, чтобы мои локальные ноутбуки прицепились к моему аккаунту, а не пропали.
- Как пользователь, я не хочу видеть `/notebooks` без логина — меня должно редиректить на `/login`.

## Acceptance criteria

### Регистрация

- [ ] Страница `/register`: поля `email`, `password`, `password confirm`. Валидация формата email, минимум 8 символов, совпадение паролей.
- [ ] Submit → POST `/auth/register` → редирект на `/verify-email-sent`.
- [ ] Ошибки сервера (email taken, weak password) показываются inline.

### Verify email

- [ ] Страница `/verify-email-sent`: «We sent a link to your@email — click it to activate». Кнопка `Resend` (rate-limited).
- [ ] Страница `/verify-email/:token` (открывается по ссылке из письма): GET `/auth/verify-email?token=...` → success → автоматический логин → редирект `/notebooks`.
- [ ] При ошибочном/expired token — экран «Link expired · Request new».

### Login

- [ ] Страница `/login`: поля `email`, `password`.
- [ ] Submit → POST `/auth/login` → сохраняет access token + refresh token → редирект на `?next=` или `/notebooks`.
- [ ] Ссылки «Forgot password?», «Don't have an account? Register».
- [ ] При попытке войти с неверифицированным email — редирект на `/verify-email-sent` с сообщением.

### Logout

- [ ] Кнопка `Logout` в user-menu в шапке.
- [ ] При logout: POST `/auth/logout`, очистка токенов, очистка `entities/session`, редирект на `/login`.
- [ ] **Локальные ноутбуки в IndexedDB НЕ удаляются** — нужно для повторного логина с того же устройства. Решение задокументировать в `docs/architecture/`.

### Password reset

- [ ] Страница `/forgot-password`: поле `email`, submit → POST `/auth/password-reset/request` → экран «Check your email».
- [ ] Страница `/reset-password/:token`: новые пароли → POST `/auth/password-reset/confirm` → редирект на `/login` с toast.

### Защищённые маршруты

- [ ] HOC / роутер-guard `requireAuth` оборачивает страницы `/notebooks`, `/n/:id`, `/settings`.
- [ ] Анонимный пользователь редиректится на `/login?next=<original>`.
- [ ] Для маршрутов, где можно работать офлайн без логина (например, демо-ноутбук на `/n/demo`) — `optionalAuth`.

### Сессия и токены

- [ ] Access token хранится в **памяти + sessionStorage**; refresh token — в **httpOnly cookie** (со стороны бэка). На моках — оба в sessionStorage с пометкой «mock only, prod uses httpOnly cookie».
- [ ] При 401 от любого `@/shared/api` вызова — авто-попытка refresh; если refresh падает — logout + редирект на `/login`.
- [ ] Существующий `entities/session` атом обновляется в одном месте; чтение из других фич — только через computed `currentUserAtom`.

### Миграция локальных ноутбуков при первом логине

- [ ] При первом успешном логине **с этого устройства** — модалка «We found N local notebooks. Attach them to your account?».
- [ ] Опции: `Attach all`, `Discard`, `Choose…` (чекбоксы).
- [ ] `Attach all` → bulk POST `/notebooks/import` со списком → серверные id возвращаются → локальные записи получают `ownerId` и `serverId`, чтобы дальше работал sync.
- [ ] Решение запоминается per-device (не показывать при следующих логинах того же пользователя).

### User menu

- [ ] В шапке справа — аватар (инициалы) + email.
- [ ] Меню: `Profile settings`, `Theme`, `Sign out`.

## Tech notes

### Файлы

```
src/pages/
  login/                            ← существующая, рефакторинг
  register/                         ← новая
  verify-email/                     ← новая
  verify-email-sent/                ← новая
  forgot-password/                  ← новая
  reset-password/                   ← новая
src/features/auth/
  model/
    authActions.ts                  ← login/register/logout/refresh/verify/reset
    authForms.ts                    ← reatomForm-ы для всех экранов
    session.ts                      ← (мб переехать сюда из entities/session)
    sessionGuard.ts                 ← requireAuth / optionalAuth
    importLocalNotebooks.ts         ← миграция локального → user
  ui/
    LoginForm.tsx
    RegisterForm.tsx
    ForgotPasswordForm.tsx
    ResetPasswordForm.tsx
    VerifyEmailScreen.tsx
    ImportLocalNotebooksDialog.tsx
    UserMenu.tsx
src/shared/api/auth.ts              ← +register/verify/forgot/reset/refresh
openapi/auth.openapi.yaml           ← расширить
```

### Reatom

- Формы — `reatomForm` + `reatomField` (см. AGENTS.md, ad-hoc forms запрещены).
- Защищённые routes через `urlAtom` + `computed`: при выводе компонента проверяем `currentUserAtom`, при null — `navigate('/login?next=...')`.
- 401-interceptor — в `src/shared/api/client.ts`: `openapi-fetch` middleware, при 401 → пробуем refresh → retry → fail = logout.

### Контракт auth (OpenAPI, дельта)

```
POST /auth/register                 -> 201 { user, accessToken? } (пока не verified — без токена)
POST /auth/verify-email             -> 200 { user, accessToken, refreshToken }
POST /auth/login                    -> 200 { user, accessToken, refreshToken } | 403 { reason: 'email_not_verified' }
POST /auth/logout                   -> 204
POST /auth/refresh                  -> 200 { accessToken } | 401
POST /auth/password-reset/request   -> 204 (всегда, не раскрываем существование email)
POST /auth/password-reset/confirm   -> 204
POST /notebooks/import              -> 201 { mapping: { localId -> serverId } }
GET  /me                            -> 200 { user } | 401
```

### Хранение токенов

В моках — sessionStorage. В коде — единая обёртка `src/shared/lib/auth/tokenStore.ts` с методами `getAccess()`, `setAccess()`, `clear()`. На бэк-стейдже меняем имплементацию на cookie-based.

### Маркировка анонима

`currentUserAtom: Atom<User | null>`. Все sync/notebookList фичи проверяют этот атом:

- `null` → можно работать только с локальными, sync disabled (badge `Offline only`).
- `User` → активный pull/push, видны серверные ноутбуки.

## Mock strategy

- **MSW** хранит in-memory `Map<email, { passwordHash, verified, id, name }>` + `Map<token, userId>`.
- `POST /auth/register` — добавляет с `verified: false`, возвращает 201; письмо «не отправляется», в dev-overlay показываем «Verify link: /verify-email/<token>» для удобства тестирования.
- `POST /auth/verify-email` — флипает `verified: true`, выдаёт пару токенов.
- `POST /auth/login`:
  - неизвестный email / неверный пароль → 401;
  - `verified: false` → 403 с `reason: 'email_not_verified'`;
  - ok → токены.
- `POST /auth/refresh` — выдаёт новый access, ротация refresh.
- `POST /auth/password-reset/*` — токен всегда «valid», в dev-overlay показываем ссылку.
- `POST /notebooks/import` — принимает локальные ноутбуки, генерит серверные id, возвращает mapping.
- Сценарии:
  - `?force=email-not-verified` — тестирует флоу verify;
  - `?force=expired-token` — тестирует expired link;
  - dev-overlay имеет кнопки «Make next login 500», «Force token expiry» — для ручной проверки edge cases.

## Out of scope

- OAuth (Google/GitHub) — отдельный эпик, нужен реальный бэк.
- 2FA / TOTP.
- Delete account / GDPR export.
- Изменение email.
- Реальные email-письма (мок-overlay показывает ссылку напрямую).
- Управление сессиями / устройствами.
- Тарифные планы / биллинг.

## Dependencies

- Нет жёстких. [Epic 02](./02-notebook-data-model.md) нужен для миграции локальных ноутбуков (без него `Attach all` бессмысленно).
- Блокирует полноценный [Epic 05](./05-sync-ui.md).
