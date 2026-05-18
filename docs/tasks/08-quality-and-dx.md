# Epic 08 — Quality & DX

## Why

«Невидимая» работа, которая определяет, насколько продукт ощущается зрелым и сколько чужих заметок мы сможем переварить:

- **a11y** — keyboard navigation, контраст, ARIA. Без этого notebook-app становится непригодным для значительной части аудитории.
- **i18n** — даже если запускаемся на одном языке, инфраструктура должна быть готова, иначе её придётся ретроактивно вкорнять.
- **.ipynb import/export** — критично для входа в нишу Jupyter-пользователей: «попробуй у нас свой ноутбук».
- **Error boundaries + telemetry** — без них прод-баги невидимы. Особенно для пользовательского кода в Worker, который может крашить части UI.

Эпик идёт последним, потому что лучше делать на стабилизированных фичах — иначе a11y-чеки протухнут на каждом рефакторе.

## User stories

- Как пользователь с клавиатуры/screen reader, я могу полноценно работать с ноутбуком.
- Как пользователь, мне предлагают язык интерфейса; если потом добавят русский — мне не нужно заново настраивать продукт.
- Как пользователь Jupyter, я могу импортировать свой `.ipynb` и продолжить работу.
- Как поддержка, я могу понять, что у пользователя сломалось, по логам.
- Как разработчик, я доверяю продакшну: при крэше React-дерева пользователь не видит белый экран.

## Acceptance criteria

### Accessibility

- [ ] Все интерактивные элементы доступны клавиатурой (tab-order логичный, focus-ring видимый).
- [ ] Все шорткаты из [Epic 03](./03-cell-editing-ux.md) работают для пользователя клавиатуры — в т.ч. drag-and-drop ячеек (через `@dnd-kit` keyboard sensor).
- [ ] Все интерактивы имеют корректные ARIA-роли/лейблы; модалки — `role="dialog"` + focus trap + ESC-close + restore focus.
- [ ] Контраст текста ≥ 4.5:1 (Axe-чек зелёный).
- [ ] `prefers-reduced-motion` уважается: тяжёлые анимации (drag-preview, stream-cursor) отключаются.
- [ ] Лайв-регионы (`aria-live`) для: «Saving…», «Synced», «Generation done», «Cell N failed».
- [ ] Storybook/тест с `vitest-axe` для NotebookCell, ConflictDialog, LoginForm — 0 violations.

### i18n

- [ ] Инфраструктура: `i18next` + `react-i18next`, lazy-loading namespace по странице.
- [ ] Все user-facing строки извлечены в JSON (`src/shared/i18n/en/common.json`, …/notebook.json, …/auth.json).
- [ ] Дефолтный язык — `en`. Подготовлен `ru` (даже с английскими значениями — для проверки fallback).
- [ ] Селектор языка в user-menu.
- [ ] Сохраняется в `localStorage` + `<html lang="...">`.
- [ ] Конвенция именования ключей задокументирована (`<feature>.<screen>.<element>`).
- [ ] Линтер-rule (eslint-plugin-i18next) ловит хардкод-строки в JSX.

### .ipynb import/export

- [ ] Кнопка `Import` в `/notebooks`: принимает `.ipynb` файл.
- [ ] Парсер преобразует `.ipynb` v4 (текущая стабильная Jupyter spec) → наш формат:
  - `code` cells: `source` (массив строк → join), outputs (text/plain → `OutputItem.stdout`, image/png → `OutputItem.image`).
  - `markdown` cells: соотв.
  - `raw` cells: импортируем как `markdown` с пометкой «raw cell from .ipynb».
- [ ] Поля, специфичные для Python (kernelspec, metadata.kernel) — игнорируем, кладём в `notebook.metadata.imported`.
- [ ] Несовместимый файл (не v4, не JSON) → понятная ошибка.
- [ ] Export: кнопка `Export → .ipynb` в шапке ноутбука. Обратное преобразование: наши `code` ячейки экспортируются с `cell_type: "code"`, language metadata `javascript`. Скачивается через `Blob` + anchor download.
- [ ] Идемпотентность: import → export → import должен дать эквивалентный (по ячейкам) ноутбук.

### Error boundaries

- [ ] Корневой error-boundary на `app/`: при unexpected crash — экран с message + кнопкой `Reload`. Под капотом отправляет событие в телеметрию.
- [ ] Per-cell error boundary вокруг `NotebookCell`: если рендер одной ячейки крашится — другие живут, ячейка показывает «This cell failed to render · [Reload cell] [Copy source]».
- [ ] Boundary вокруг `OutputFrame` (iframe с DOM-выводом): если внутри что-то ломает рендер — не сносит ячейку.

### Telemetry

- [ ] Тонкий hook `useEvent('event.name', payload)` (или action `track`).
- [ ] События: `notebook.opened`, `cell.run`, `cell.run.error`, `cell.interrupted`, `sync.conflict`, `llm.generated`, `llm.error`, `unhandled.error`, `boundary.caught`.
- [ ] **На моках** — пишем в `console.debug` + хранилище-кольцо в `entities/telemetry` (последние 200 событий), доступно в dev-overlay.
- [ ] Реальный backend (Sentry / PostHog / собственный) — за флагом окружения, подключается позже без затрагивания кода фич.
- [ ] PII (email, source кода) не отправляется по умолчанию. Source — только размер и язык.

### Bundle hygiene

- [ ] Bundle analyzer (vite-bundle-visualizer) в `pnpm build:analyze`.
- [ ] Целевой initial bundle ≤ 350 КБ gzip без editor/markdown.
- [ ] CodeMirror, KaTeX, markdown-renderer — code-split по странице/ячейке.
- [ ] Reatom worker и iframe runtime — отдельные чанки.

## Tech notes

### Файлы

```
src/app/
  ErrorBoundary.tsx                ← корневой
  routes.tsx                       ← оборачивает routes в boundary
src/features/notebook/ui/
  NotebookCell.tsx                 ← per-cell boundary внутри
src/shared/i18n/
  index.ts                         ← init i18next, useTranslation re-export
  en/common.json
  en/notebook.json
  en/auth.json
  ru/...
src/shared/lib/a11y/
  useFocusTrap.ts
  useAnnounce.ts                   ← aria-live API
src/features/ipynb/
  model/
    importIpynb.ts
    exportIpynb.ts
    importIpynb.test.ts
    exportIpynb.test.ts
  ui/
    ImportIpynbButton.tsx
    ExportIpynbButton.tsx
src/entities/telemetry/
  model/track.ts
  ui/TelemetryDevOverlay.tsx
```

### A11y

- Сначала прогоняем Axe (`@axe-core/react` в dev, vitest-axe в тестах) — собираем baseline-violations.
- Чиним по приоритету: keyboard, focus, ARIA, контраст.
- Конкретные проблемные места из текущего кода: drag handle нужен `role="button" aria-grabbed`, dropdown-menu из `@base-ui/react` — проверить focus trap.

### i18n

- Не выбираем сложный pluralization (на старте en/ru хватает базового).
- ICU MessageFormat — overkill для MVP, берём базовый interpolation.
- В тестах: рендерим в `i18next.changeLanguage('cimode')` (возвращает ключи) — стабильные снепшоты не зависят от перевода.

### .ipynb формат

Спека: https://nbformat.readthedocs.io/en/latest/format_description.html. Для импорта достаточно покрыть `cells[]` с `cell_type` in `code|markdown|raw`. Outputs парсим минимально — Jupyter-output protocol богатый, нам нужны `stream` (stdout/stderr), `execute_result` (text/plain → stdout, image/png → image), `error` (стек).

### Telemetry

```ts
// src/entities/telemetry/model/track.ts
export const track = action((name: string, payload?: Record<string, unknown>) => {
  ringBufferAtom.set((events) => [...events, { name, payload, at: Date.now() }].slice(-200))
  if (import.meta.env.PROD && config.telemetryUrl) {
    void fetch(config.telemetryUrl, {
      method: 'POST',
      body: JSON.stringify({ name, payload }),
    }).catch(() => {})
  }
}, 'telemetry.track')
```

Никаких пакетов на старте — switch на Sentry/PostHog позже за один день.

### Error boundary с Reatom

React 19 поддерживает компонентные error boundaries, но для функциональных мы используем `react-error-boundary` (тонкий, ~3 КБ). Внутри `onError` — `track('boundary.caught', { ... })`.

## Mock strategy

Эпик клиентский, моки задействованы только для telemetry-endpoint:

- `POST /telemetry/event` — MSW отдаёт 204, ничего не делает. В dev смотрим события через ring-buffer overlay.
- `.ipynb`-импорт работает с реальными файлами через input — ничего мокать не нужно. В Storybook/тестах подсовываем фикстуры из `src/features/ipynb/__fixtures__/`.

## Out of scope

- Sentry/PostHog интеграция (только подготовка hook).
- Pluralization, RTL, динамическая смена локали без reload (пока — reload).
- Полная WCAG AAA — целимся в AA.
- Импорт Colab-специфичных расширений.
- Печатная вёрстка ноутбука (print stylesheet).

## Dependencies

- Реалистично — последний эпик. Опирается на:
  - [Epic 01](./01-execution-runtime.md) — `OutputItem` для конвертации `.ipynb` outputs.
  - [Epic 02](./02-notebook-data-model.md) — формат и `Notebook.metadata`.
  - [Epic 03](./03-cell-editing-ux.md) — без шорткатов a11y-аудит бессмысленен.
  - [Epic 04](./04-notebook-management.md) — кнопки Import/Export живут в списке/шапке.

A11y и i18n стоит **закладывать понемногу в каждом предыдущем эпике** — а здесь добиваем хвост и оформляем фокусный аудит.
