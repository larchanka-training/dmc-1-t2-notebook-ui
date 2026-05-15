# Spec — генерация API-клиента из OpenAPI + прослойка `shared/api`

Ветка: `feat_add_openapi_generator`

---

## 1. Контекст и проблема

Сейчас в `ui/` нет работы с реальным HTTP API: фичи (`features/auth`, `features/notebook`) работают со своим локальным состоянием. Скоро понадобится ходить в бэкенд. Чтобы:

- не дублировать руками типы запросов/ответов,
- не привязываться к конкретному HTTP-клиенту/генератору в бизнес-логике,
- иметь возможность поменять транспорт или генератор без переписывания фич,

нужно ввести **сгенерированный API-клиент** (из OpenAPI/Swagger) и **прослойку (facade)** между ним и фичами.

## 2. Цели

1. Завести в проекте OpenAPI-спеку (локальный файл в репе) и npm-скрипт генерации клиента из неё.
2. Сравнить **несколько генераторов** на двух демо-спеках и выбрать один по итогам PoC.
3. Зафиксировать слой `src/shared/api/` — единственный публичный API HTTP-слоя для фич.
4. Запретить прямые импорты сгенерированного клиента из `features/*` и `pages/*` (через линт или соглашение в docs/architecture).

## 3. Не-цели

- Не подключаем реальный бэкенд в этой задаче — только демо-спеки.
- Не переписываем существующие `features/notebook`, `features/auth` на HTTP — это отдельные тикеты.
- Не вводим SSR / RSC / SWR / React Query — состояние и кеш живут в Reatom (см. `docs/architecture/reatom.md`).
- Не пишем mock-сервер (MSW) в рамках этой задачи. Можно добавить отдельным тикетом.

## 4. Архитектурное решение

### 4.1. Слои и правила импорта

Стартовая раскладка — **плоская**, всё HTTP/REST лежит прямо в `shared/api/`. Никаких подпапок-по-транспорту (`rest/`, `ws/`) **пока** не вводим — это будет лишняя вложенность ради гипотетики (см. 4.2 про триггер миграции).

```
src/
├── shared/
│   └── api/
│       ├── generated/        # ⛔ сгенерировано, коммитим. Никто извне не импортирует.
│       │   └── <generator-output>
│       ├── client.ts         # сконфигурированный transport (baseUrl, auth, error mapping)
│       ├── errors.ts         # доменные ошибки (ApiError, UnauthorizedError, ...)
│       ├── auth.ts           # тонкие функции: login(), logout(), me()
│       ├── notebook.ts       # тонкие функции: listNotebooks(), runCell(), ...
│       └── index.ts          # ре-экспорт публичных функций + типов
└── features/<name>/model/...
        └── импортирует ТОЛЬКО `@/shared/api`, не `@/shared/api/generated`
```

**Правила:**

- `shared/api/generated/**` — внутренний имплементационный детал. Никто, кроме файлов `shared/api/*.ts`, его не импортирует.
- Публичный API слоя — именованные функции по доменам: `auth.login(...)`, `notebook.list(...)`. Файлы группированы по доменам, экспорт плоский (`import { login } from '@/shared/api'` либо namespace `import * as authApi from '@/shared/api/auth'` — финальный стиль выберем в PoC).
- `shared/api` остаётся **framework-agnostic**: без Reatom, без React. Возвращаем `Promise<T>`, выбрасываем доменные ошибки. Reatom-обвязка (atom/action/`wrap`) живёт в `features/*/model/*.ts`.
- В фичах вызов идёт через `await wrap(api.notebook.list())` внутри `action`/`onConnect` — потому что в проекте включён `clearStack()` (см. `docs/architecture/reatom.md`).

### 4.2. Когда вводить разбиение по транспорту

Триггер миграции на `shared/api/rest/` + `shared/api/ws/` (или `shared/api/sse/`) — **появление реального второго транспорта**. Для notebook-проекта это вероятно (стриминг output ячеек по WS/SSE), но пока такого требования нет.

При срабатывании триггера: одним рефакторинг-PR переезжаем `shared/api/*.ts` → `shared/api/rest/*.ts`, и рядом появляется `shared/api/ws/`. Публичный API в `@/shared/api` остаётся прежним (через ре-экспорт из `index.ts`) — потребители в `features/*` не правятся.

### 4.3. Почему тонкие функции, а не Reatom-actions в shared

Это нарушение текущего правила фрактала: `shared/` не должен знать про бизнес-логику и фреймворк. См. `docs/architecture/folder-structure.md`. Reatom-обвязку держим в `features/*` — она там, где живёт состояние и оркестрация.

### 4.4. Что инкапсулирует `client.ts`

- `baseUrl` из env (`VITE_API_BASE_URL`).
- Хедеры (`Authorization`, `Content-Type`).
- Маппинг HTTP-ошибок в доменные (`401 → UnauthorizedError`, `5xx → ApiError`).
- Никаких глобальных stateful-объектов: токен передаётся через геттер (например, `getAuthToken: () => string | null`), инициализируется при старте приложения в `app/providers`.

## 5. PoC: сравнение генераторов

Раз нет однозначного выбора — делаем мини-PoC: гоняем 2 спеки через 2 генератора и сравниваем по фиксированным критериям.

### 5.1. Кандидаты

| Кандидат                                      | Что генерит                                        | Транспорт |
| --------------------------------------------- | -------------------------------------------------- | --------- |
| **A. `@hey-api/openapi-ts`**                  | типы + tree-shakeable SDK                          | fetch     |
| **B. `openapi-typescript` + `openapi-fetch`** | только типы; клиент — типизированный fetch-обёртка | fetch     |

(Можно расширить до трёх, добавив `orval` — но это решаем после A/B.)

### 5.2. Демо-спеки (`openapi/` в корне `ui/`)

Сделаем **две минимальные** спеки, чтобы прогнать оба генератора:

1. `openapi/auth.openapi.yaml` — `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Покрывает: тело запроса, заголовки авторизации, схему ошибок (`401`).
2. `openapi/notebook.openapi.yaml` — `GET /notebooks`, `POST /notebooks`, `POST /notebooks/{id}/cells/{cellId}/run`. Покрывает: path-параметры, list+detail, polymorphic response (`status: running | done | error`).

Это даёт нам репрезентативный набор: auth-флоу + ресурс с вложенностями.

> Один или два файла объединить в `openapi.yaml` — решение PoC. Если генераторы лучше работают с одной спекой, склеим через `$ref` или редактор.

### 5.3. Критерии сравнения

| Критерий                     | Как меряем                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| Размер сгенерированного кода | `du -sh src/shared/api/generated`                             |
| Удобство писать прослойку    | Субъективно: 1 страница `notebook.ts` под каждым из вариантов |
| Tree-shaking на проде        | `pnpm build` → размер бандла с/без вызовов                    |
| TS-типы запросов/ответов     | DX в IDE: автодополнение, narrow по `status`                  |
| Поведение при ошибках        | Можем ли поймать `401` отдельным типом без `instanceof` хаков |
| Скорость генерации           | `time pnpm api:generate`                                      |
| Поддержка / актуальность     | Дата последнего релиза, открытые issues                       |

PoC завершается **решением в этом же документе** (раздел «Decision») и оставляет в репе только победителя.

## 6. Скрипты и tooling

Добавить в `package.json`:

```json
{
  "scripts": {
    "api:generate": "<команда выбранного генератора>",
    "api:check": "<генерируем во временную папку и diff с src/shared/api/generated>"
  }
}
```

- `api:generate` запускается **вручную** при изменении `openapi/*.yaml`.
- `api:check` подключается в lefthook (pre-commit или pre-push) — фейлит, если сгенерированный код в репе разъехался с текущей спекой.
- CI прогоняет `api:check` + `pnpm typecheck` + `pnpm test` (см. `docs/ci-cd.md`).

`.prettierignore` уже исключает `src/**/generated`, `openapi.yaml`, `openapi.json` — оставляем.

`tsconfig.app.json` — добавить `src/shared/api/generated` в `include`, но при необходимости исключить из строгих правил линта (`eslint.config.js` → override для папки `generated`).

## 7. Тесты

- `shared/api/client.test.ts` — мокаем `fetch`, проверяем: подстановка `baseUrl`, авто-добавление `Authorization`, маппинг `401` в `UnauthorizedError`.
- `shared/api/auth.test.ts` (и `notebook.test.ts`) — мокаем `fetch`, проверяем что тонкие функции корректно вызывают transport с правильным path/body.
- Тесты сгенерированного кода **не пишем** — это ответственность генератора.

## 8. Документация

После выполнения добавить:

- `docs/architecture/api-layer.md` — слой `shared/api`, правила импорта, как добавлять новый эндпоинт.
- В `docs/architecture/folder-structure.md` — упомянуть `shared/api/`.
- В `AGENTS.md` — пункт «работа с HTTP API: только через `@/shared/api`».
- В `.agents/add-endpoint.md` — пошаговый рецепт: «обновить спеку → `pnpm api:generate` → добавить тонкую функцию в `shared/api/<domain>.ts` → ре-экспорт из `index.ts`».

## 9. Открытые вопросы (закрыть до старта PoC или в его процессе)

1. **Одна спека или несколько?** Если бэк отдаёт один монолитный openapi.json — клеим в один файл; если по сервисам — храним отдельно и генерируем в подпапки `generated/auth`, `generated/notebook`.
2. **Стиль публичного API:** namespace (`authApi.login`) vs плоский экспорт (`login` из `@/shared/api`). Решим после первого черновика прослойки.
3. **Где хранить токен** — отдельным атомом в `features/auth/model` (предпочтительно) или в `localStorage` напрямую из `shared/api/client.ts`. По-хорошему — атом + `client.ts` получает токен через геттер.
4. **MSW для dev/тестов** — отдельный тикет; в этой задаче только подготовим прослойку так, чтобы MSW потом легко встроился (мокаем fetch на уровне msw).

## 10. Acceptance criteria

- [ ] В репе появились `openapi/auth.openapi.yaml` и `openapi/notebook.openapi.yaml`.
- [ ] В `package.json` есть скрипт `api:generate`, по которому из `openapi/*.yaml` собирается код в `src/shared/api/generated/`.
- [ ] Решение по генератору зафиксировано в этом документе (раздел «Decision») с короткими цифрами по критериям из 5.3.
- [ ] В `src/shared/api/` есть `client.ts`, `errors.ts`, минимум один доменный файл (`auth.ts` или `notebook.ts`) и `index.ts`.
- [ ] Прослойка покрыта unit-тестами (`shared/api/*.test.ts`), `pnpm test` проходит.
- [ ] `pnpm typecheck` и `pnpm lint` проходят, бандл `pnpm build` собирается.
- [ ] `api:check` запускается в pre-commit/pre-push и фейлит при расхождении.
- [ ] Добавлен `docs/architecture/api-layer.md` и упоминание в `AGENTS.md` + `docs/architecture/folder-structure.md`.
- [ ] Нет ни одного импорта `shared/api/generated/**` из `features/*` или `pages/*` (грепом).

## 11. План работ

1. **Подготовка спек.** Написать `openapi/auth.openapi.yaml` и `openapi/notebook.openapi.yaml`. Валидировать через `npx @redocly/cli lint`.
2. **PoC #1 — `@hey-api/openapi-ts`.** Установить, настроить, сгенерировать в `src/shared/api/generated/`, написать черновик `shared/api/notebook.ts`. Замерить критерии из 5.3.
3. **PoC #2 — `openapi-typescript` + `openapi-fetch`.** То же самое в отдельной ветке-черновике или подпапке.
4. **Decision.** Дописать раздел «Decision» сюда. Удалить проигравший вариант из репы.
5. **Финализация прослойки.** Дописать `client.ts`, `errors.ts`, оба доменных файла, `index.ts`, тесты.
6. **Tooling.** `api:generate`, `api:check`, lefthook-хук, ESLint-правило (`no-restricted-imports` на `**/generated/**` из `features`/`pages`).
7. **Документация.** `docs/architecture/api-layer.md`, апдейт `AGENTS.md` и `folder-structure.md`, `.agents/add-endpoint.md`.
8. **PR.** Один PR на всю задачу (PoC коммиты можно squash'нуть в финальные).

## 12. Decision

**Выбран: `openapi-typescript` + `openapi-fetch`.**

### Цифры (на наших двух демо-спеках)

| Критерий                                    | `@hey-api/openapi-ts` 0.97.1                                                      | `openapi-typescript` 7.13 + `openapi-fetch` 0.17 |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Сгенерированный код (диск)                  | 176K                                                                              | 16K                                              |
| Сгенерированный код (строки TS)             | 4209                                                                              | 392                                              |
| Файлов на спеку                             | 6 (`sdk.gen.ts`, `types.gen.ts`, `client.gen.ts`, `index.ts`, `client/`, `core/`) | 1 (`*.d.ts`)                                     |
| Runtime в проде                             | свой `client + core` рядом с типами                                               | `openapi-fetch` ~6KB min+gz                      |
| Facade LOC (`notebook.ts`)                  | 33                                                                                | 33                                               |
| Polymorphic discriminator (`CellRunResult`) | ✅ после split-config; ❌ при merge-input                                         | ✅                                               |
| Имена в generated                           | `listNotebooks`, `createNotebook` (clean)                                         | N/A — типы по `operationId` в `operations`       |
| Обработка ошибок в фасаде                   | `throwOnError: true` повторяется в каждом вызове                                  | `{ data, error }` envelope + `if (error) throw`  |
| Версия / стабильность                       | pre-1.0 (0.97), API менялся между минорами                                        | оба >1.0, стабильнее                             |

### Обнаруженные подводные камни

- **hey-api при `input: [a.yaml, b.yaml]` (merge-режим)** ломает discriminator mapping: `status: 'notebook_openapi_CellRunRunning'` вместо `'running'`. Лечится split-режимом (`input: [...], output: [...]`), но это значит, что один бэк-API с одной спекой работает нормально, а multi-spec — только через множественные jobs.
- `@hey-api/client-fetch` оказался deprecated и впилен в `@hey-api/openapi-ts`. Импортное имя плагина (`'@hey-api/client-fetch'`) — то же; пакет ставить отдельно не надо.
- В hey-api `output.format` deprecated → `output.postProcess: ['prettier']`. Версия меняется быстро — это риск для лонг-терм поддержки прослойки.

### Аргументация выбора

1. **Меньше шума в репе и diff'ах** — 392 строки против 4209. Сгенерированный код мы коммитим, и каждое обновление спеки даёт diff. На реальном бэке это масштабируется в десятки/сотни эндпоинтов.
2. **Меньше runtime в бандле** — `openapi-fetch` (~6KB) против `client + core` от hey-api на каждый сгенерированный клиент.
3. **Чище концептуально** — генератор отдаёт **только типы**, прослойка пишется руками поверх типизированного fetch. Это ровно то, что нам нужно: «прослойка инкапсулирует transport». У hey-api есть готовые SDK-функции, но мы их всё равно перепаковываем — двойной слой.
4. **Стабильнее** — обе либы >1.0, у hey-api 0.97.1 в активной разработке (риск ломающих изменений между минорами).
5. **DX-паритет** — `http.POST('/notebooks/{notebookId}/cells/{cellId}/run', { params: { path: {...} } })` так же удобно, как `runCellSdk({ path: {...} })`, и автокомплит на path-литералах работает корректно.

### Что hey-api умеет лучше — YAGNI на сейчас

- Plugins: `@hey-api/zod`, `@tanstack/react-query`, `valibot`, `fastify` и др. Если когда-то понадобится Zod-валидация ответов или React Query — пересмотрим. Сейчас не нужны: валидация ответов нам не требуется (доверяем бэку и типам), React Query не используем (есть Reatom).
- Готовые named SDK-функции. Мы их и так перепаковываем в `shared/api/*`, выгоды нет.

### Что удаляем

- `node_modules`: `@hey-api/openapi-ts` (dev-dep).
- `src/shared/api/generated/hey-api/` (вся папка).
- `src/shared/api/notebook.poc-hey-api.ts` (драфт-фасад).
- `openapi-ts.config.ts` (конфиг hey-api).

### Что остаётся и финализируется

- `openapi-typescript`, `openapi-fetch` в dev/prod-deps.
- `src/shared/api/generated/openapi-ts/{auth,notebook}.d.ts`.
- Драфт `src/shared/api/notebook.poc-openapi-fetch.ts` → раскладывается в `client.ts`, `errors.ts`, `auth.ts`, `notebook.ts`, `index.ts` (шаг 5 плана).

---

## Приложение A. Скелет публичного API (целевой вид)

```ts
// src/shared/api/index.ts
export * as auth from './auth'
export * as notebook from './notebook'
export { ApiError, UnauthorizedError } from './errors'
export type { components } from './generated' // если генератор отдаёт schema-types
```

```ts
// src/shared/api/notebook.ts
import { client } from './client'
import type { components } from './generated'

export type Notebook = components['schemas']['Notebook']

export async function list(): Promise<Notebook[]> {
  return client.get('/notebooks')
}

export async function runCell(
  notebookId: string,
  cellId: string,
): Promise<components['schemas']['CellRunResult']> {
  return client.post(`/notebooks/${notebookId}/cells/${cellId}/run`)
}
```

```ts
// src/features/notebook/model/notebook.ts (пример использования)
import { action, atom, wrap } from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'

export const notebooksAtom = atom<Notebook[]>([], 'notebook.list')

export const loadNotebooks = action(async () => {
  const list = await wrap(notebookApi.list())
  notebooksAtom.set(list)
}, 'notebook.load')
```
