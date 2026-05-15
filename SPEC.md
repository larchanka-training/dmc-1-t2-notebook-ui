# SPEC: Миграция UI на Fractal Frontend

Спецификация миграции текущего UI-проекта (`ui/src/`) на архитектуру
Fractal Frontend (см. `.claude/skills/fractal-frontend`).

---

## 1. Objective

**Что:** Перевести существующую структуру (`pages/`, `components/ui`,
`components/common`, `hooks/`, `lib/`) на слои Fractal Frontend:
`app/`, `pages/`, `widgets/`, `features/`, `shared/`.

**Зачем:** Учебный проект `dmc-1-t2-notebook` используется как
эталон архитектуры для группы TARDIS T2. Текущая плоская структура
не показывает, как разделять бизнес-фичи от инфраструктуры.

**Целевая аудитория:** студенты курса и будущие контрибьюторы. Спека
и итог миграции должны быть читаемы как пример.

**Что НЕ входит:**
- Новая бизнес-логика (реальный auth-backend, persistance ячеек и т.п.).
- Изменение визуала или поведения — UI должен остаться идентичным.
- Написание тестов под существующий код (см. §5).
- Рефакторинг shadcn-компонентов внутри.

---

## 2. Commands

Команды не меняются:

```bash
pnpm dev      # vite dev-server
pnpm build    # tsc -b && vite build  — основной gate миграции
pnpm lint     # eslint .
pnpm preview  # vite preview
```

**Gate после каждого шага миграции:**
1. `pnpm build` проходит без ошибок.
2. `pnpm lint` не показывает новых ошибок.
3. Ручная проверка в браузере: открывается каждая из 5 страниц,
   notebook-ячейка запускается, sidebar навигация работает.

---

## 3. Project Structure

### 3.1. Текущая структура

```
src/
  App.tsx                          — router + Layout
  main.tsx                         — entry
  App.css                          — НЕ ИМПОРТИРУЕТСЯ (мёртвый)
  index.css                        — глобальные стили
  assets/                          — НЕ ИМПОРТИРУЕТСЯ (мёртвый)
  components/
    ui/                            — 17 shadcn-компонентов
    common/
      AppSidebar.tsx
      NotebookCell.tsx
  hooks/
    use-mobile.ts
  lib/
    utils.ts                       — cn()
    executeJS.ts                   — runtime для notebook-ячеек
  pages/
    NotebookPage.tsx
    LoginPage.tsx
    AboutPage.tsx
    ShadcnComponentsPage.tsx
    CustomComponentsPage.tsx
```

### 3.2. Целевая структура

```
src/
  app/
    index.tsx                      — entry (бывший main.tsx)
    App.tsx                        — BrowserRouter + Routes
    layouts/
      AppLayout.tsx                — SidebarProvider + header + Outlet
      AppSidebar.tsx               — сайдбар (бывший common/AppSidebar.tsx)
    providers/
      AppProviders.tsx             — TooltipProvider и т.п.
    styles/
      index.css                    — глобальные стили
  pages/
    notebook/
      ui/NotebookPage.tsx          — тонкая страница, импортирует фичу
      index.ts
    login/
      ui/LoginPage.tsx             — тонкая, рендерит features/auth
      index.ts
    about/
      ui/AboutPage.tsx
      index.ts
    shadcn-components/
      ui/ShadcnComponentsPage.tsx
      index.ts
    custom-components/
      ui/CustomComponentsPage.tsx
      index.ts
  features/
    notebook/
      domain/
        cell.ts                    — type Cell, type CellStatus, uid, makeCell
      model/
        executeJS.ts               — runtime
        useNotebook.ts             — state (cells, addCell, runCell, …)
      ui/
        NotebookCell.tsx
        NotebookView.tsx           — композиция (header + список ячеек)
      index.ts                     — публичный API: NotebookView
    auth/
      ui/
        LoginForm.tsx              — форма (бывший контент LoginPage)
      index.ts                     — публичный API: LoginForm
  shared/
    ui/                            — все 17 shadcn-компонентов (БЕЗ index.ts)
    lib/
      cn.ts                        — бывший lib/utils.ts (переименовать по домену)
      use-mobile.ts                — бывший hooks/use-mobile.ts
```

### 3.3. Решения по размещению (обсуждено)

| Что | Куда | Почему |
|---|---|---|
| `AppSidebar` | `app/layouts/` | Часть единого Layout, не переиспользуется на нескольких страницах |
| `LoginPage` форма | `features/auth/` + тонкая `pages/login/` | Готовность к signup/recovery, разделение page/feature |
| `executeJS` | `features/notebook/model/` | Это бизнес-логика notebook, не инфраструктура (правило 7-4) |
| `cn`, `use-mobile` | `shared/lib/` | Чистые утилиты без бизнес-логики |
| shadcn `ui/*` | `shared/ui/` | Инфраструктурный UI-kit, прямые импорты (правило 7-3 exception) |
| `App.css`, `assets/` | удалить | Мёртвый код, нигде не импортируется |

### 3.4. Импорты

- Алиас `@/*` уже настроен в `tsconfig.app.json` — остаётся.
- Импорты модулей — только через `index.ts` (правило 7-3).
- `shared/ui/*` — прямой импорт файла (исключение из 7-3).

### 3.5. Порядок миграции (пошагово, по коммитам)

Каждый шаг → `pnpm build` + ручная проверка + commit.

1. **shared слой:** перенос `components/ui/` → `shared/ui/`,
   `lib/utils.ts` → `shared/lib/cn.ts`, `hooks/use-mobile.ts` →
   `shared/lib/use-mobile.ts`. Обновить все импорты.
2. **app слой:** `main.tsx` → `app/index.tsx`, `App.tsx` →
   `app/App.tsx`, Layout → `app/layouts/AppLayout.tsx`, sidebar →
   `app/layouts/AppSidebar.tsx`, `index.css` → `app/styles/index.css`.
   Обновить `index.html` (`/src/main.tsx` → `/src/app/index.tsx`).
3. **features/notebook:** вынести `NotebookCell` + `executeJS` +
   state-хук из `NotebookPage`. Экспортировать `NotebookView`.
4. **features/auth:** вынести форму из `LoginPage` в `LoginForm`.
5. **pages:** превратить в тонкие обёртки (`pages/<name>/ui/*.tsx` +
   `index.ts`), импортировать фичи.
6. **cleanup:** удалить `App.css`, `assets/`, пустые папки старой
   структуры.

---

## 4. Code Style

- **TypeScript строгий** — настройки `tsconfig.app.json` не меняем.
- **Именование файлов по домену** (правило 7-5): `cell.ts`, не
  `types.ts`; `auth.ts`, не `helpers.ts`.
- **Публичный API через `index.ts`** для всех модулей кроме `shared/`
  (правило 7-3).
- **Сегменты `domain → model → ui`** только однонаправленно (7-6).
   Не каждый модуль обязан иметь все три сегмента — у `auth` пока
   только `ui/`, у `notebook` все три.
- **Никаких cross-imports между features** (7-2). Сейчас этого и
  нет — после миграции тоже не должно появиться.
- **ESLint и форматирование** — текущие настройки не меняем.
- Комментарии — по правилам репозитория: только когда WHY неочевиден.

---

## 5. Testing Strategy

**Тестов на этой итерации не пишем.** Это сознательное решение:

- Миграция = чистое перемещение файлов + перепрошивка импортов.
  Поведение не меняется.
- Реальной бизнес-логики, которую страшно сломать, нет (executeJS —
  единственный кандидат, но он покрывается ручной проверкой).
- Писать тесты с нуля для миграции — отдельный большой проект.

**Что страхует миграцию вместо тестов:**

1. `pnpm build` (TypeScript строгий) — ловит сломанные импорты и типы.
2. `pnpm lint` — ловит unused imports, мёртвый код.
3. Ручная smoke-проверка в браузере после каждого шага:
   - Открывается `/` (Notebook), ячейка запускается, output появляется.
   - `/login` рендерится, инпуты управляемые.
   - `/about`, `/components/shadcn`, `/components/custom` открываются.
   - Sidebar навигация переключает страницы.
4. Пошаговые коммиты — `git revert` дёшев, если шаг сломался.

**Когда появятся тесты:** при добавлении реальной бизнес-логики
(persistance ячеек, реальный auth, и т.п.) — отдельной задачей по
TDD.

---

## 6. Boundaries

### Always do
- Соблюдать правила из `.claude/skills/fractal-frontend/SKILL.md`
  (особенно §7 — MUST-правила).
- Делать пошаговые коммиты с понятными сообщениями.
- После каждого шага: `pnpm build` + ручная проверка в браузере.
- Сохранять идентичное поведение и визуал.

### Ask first
- Любое изменение поведения или визуала.
- Добавление новых зависимостей.
- Удаление файла, который кажется неиспользуемым, но не на 100%
  очевидно (двойная проверка через `grep`).
- Переход к `widgets/` слою (сейчас не нужен — если возникнет повод,
  обсудить).
- Создание `entities/` слоя (сейчас не нужен — бизнес-логика
  notebook вся внутри одной фичи).

### Never do
- **Cross-imports между features** (правило 7-2).
- **Бизнес-логику в `shared/`** (правило 7-4).
- **Импорты через внутренности модуля** в обход `index.ts`
  (правило 7-3).
- **Восходящие импорты** против направления `app → pages → widgets
  → features → entities → shared` (правило 7-1).
- **Технические имена файлов** (`types.ts`, `utils.ts`, `helpers.ts`).
- **Создавать фичу-на-use-case** (правило 7-7) — `features/login/`
  отдельно от `features/auth/` запрещено.
- **Добавлять новый функционал** в рамках миграции. Только перенос.
- **Писать тесты** в рамках этой задачи (см. §5).

---

## 7. Definition of Done

- [ ] Структура `src/` соответствует §3.2.
- [ ] `pnpm build` проходит.
- [ ] `pnpm lint` без новых ошибок.
- [ ] Все 5 страниц рендерятся, notebook-ячейка исполняет код,
      sidebar навигация работает.
- [ ] Старые папки (`components/`, `hooks/`, `lib/`, корневые
      `App.tsx`/`main.tsx`/`App.css`/`assets/`/`index.css`) удалены.
- [ ] Нет cross-imports между features (проверка `grep`).
- [ ] Все импорты модулей идут через `index.ts` (кроме `shared/`).
- [ ] Коммитов несколько, по шагам §3.5.
