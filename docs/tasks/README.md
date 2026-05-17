# Tasks — frontend roadmap

Этот раздел разбивает frontend-работу по JS Notebook на **8 эпиков**. Каждый эпик — отдельный документ с user story, acceptance criteria, техническими заметками, стратегией моков и явным «out of scope».

Бэкенда пока нет. Все эпики **построены так, чтобы быть реализуемыми на моках сегодня** и пережить будущую замену моков на реальный бэк без переписывания публичных API.

---

## Содержание

| #                                 | Эпик                                  | Главное, что закрывает                                                 | Зависит от    |
| --------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| [01](./01-execution-runtime.md)   | **Execution runtime**                 | Безопасное выполнение JS, shared scope, stop, структурированный output | —             |
| [02](./02-notebook-data-model.md) | **Notebook data model & persistence** | Версионируемый JSON, IndexedDB, autosave                               | —             |
| [03](./03-cell-editing-ux.md)     | **Cell editing UX**                   | Markdown, hotkeys, drag-and-drop, undo/redo, поиск в ноутбуке          | 02            |
| [04](./04-notebook-management.md) | **Notebook management**               | Список ноутбуков, CRUD, папки/тэги, поиск по списку                    | 02            |
| [05](./05-sync-ui.md)             | **Sync UX**                           | revision-based sync на MSW, статусы, conflict UI, offline→online       | 02, 06        |
| [06](./06-auth-accounts.md)       | **Auth & accounts (frontend)**        | Login/Register/Verify/Reset, миграция локальных ноутбуков пользователю | —             |
| [07](./07-llm-code-generation.md) | **LLM code generation**               | Кнопка Generate, SSE-стриминг мок, контекст ячеек                      | 01, 02        |
| [08](./08-quality-and-dx.md)      | **Quality & DX**                      | a11y, i18n, `.ipynb` import/export, error boundaries, телеметрия       | все остальные |

Рекомендуемый порядок поставки: **01 → 02 → 03/04 параллельно → 06 → 05 → 07 → 08**.

---

## Базовые соглашения (на всех эпиках)

### Стек

- React 19 + TypeScript
- Reatom (`@reatom/core` + `@reatom/react`) — состояние, роутинг, формы. `useState`/`useEffect-fetch` запрещены за пределами шаредных UI-примитивов. См. [docs/architecture/reatom.md](../architecture/reatom.md).
- Архитектура — fractal/FSD-подобная: `app → pages → features → entities → shared`. См. [docs/architecture/folder-structure.md](../architecture/folder-structure.md).
- HTTP — только через фасад `@/shared/api`. Импорт из `@/shared/api/generated/**` запрещён в `features/`, `pages/`, `app/`.
- Тесты — Vitest + Testing Library, существующая конвенция `*.test.ts(x)` рядом с файлом.

### Моки

| Слой                              | Что используем сейчас                                     | Что будет в продакшне              |
| --------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| HTTP (auth, notebooks, sync, LLM) | **MSW** в `src/app/mocks`                                 | Реальный бэкенд по тому же OpenAPI |
| Локальные ноутбуки                | **IndexedDB** через Dexie или `idb`                       | То же самое (offline-first)        |
| Sync state                        | MSW отдаёт фиктивный `revision`, держит in-memory копии   | Реальный сервер                    |
| LLM                               | MSW handler с искусственной задержкой и стримингом        | Реальный LLM-прокси                |
| Auth                              | MSW отдаёт mock JWT, валидирует email/пароль из in-memory | Реальный auth-сервис               |

**Контракт**: код фич ходит в моки только через `@/shared/api/*` и `@/shared/lib/storage` (для IndexedDB). После прихода бэка меняется только MSW-handlers / клиент, не features.

### OpenAPI

Любой новый эндпоинт = сначала редактирование `openapi/<domain>.openapi.yaml` → `pnpm api:generate` → тонкая обёртка в `src/shared/api/<domain>.ts` → MSW-handler в `src/app/mocks/handlers.ts`. См. [docs/architecture/api-layer.md](../architecture/api-layer.md) и `.agents/add-endpoint.md`.

### Definition of Done (общая)

Эпик считается готовым, когда:

1. Все Acceptance Criteria выполнены и продемонстрированы вживую в браузере.
2. Покрытие тестами: модель (Reatom-атомы/actions) — unit-тесты; критичные UI-сценарии — RTL-тесты.
3. `pnpm typecheck && pnpm lint && pnpm test` зелёные.
4. Нет регрессий по уже зелёным эпикам (smoke-проверка золотых сценариев).
5. Обновлены `docs/` (`docs/notebook/`, `docs/architecture/`, при необходимости — новые странички).

---

## Шаблон task-документа

Каждый эпик использует один формат:

```markdown
# Epic NN — <название>

## Why

Зачем этот эпик существует, какую проблему пользователя/системы решает.

## User stories

- Как <роль>, я хочу <действие>, чтобы <цель>.

## Acceptance criteria

- [ ] Конкретное проверяемое поведение.

## Tech notes

- Файлы, Reatom-модель, API-контракт, что меняется в OpenAPI/MSW, ключевые решения и trade-offs.

## Mock strategy

- Как именно мокаем (MSW handler / IndexedDB / in-memory), что подсовываем в успешный/конфликтный/таймаут кейс.

## Out of scope

- Что НЕ входит в эпик (часто закрывается соседним эпиком).

## Dependencies

- Эпики, которые должны быть готовы до старта.
```
