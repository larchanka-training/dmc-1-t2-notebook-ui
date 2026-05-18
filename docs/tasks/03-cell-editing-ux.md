# Epic 03 — Cell editing UX

## Why

Базовый редактор есть, но не дотягивает до Jupyter-уровня UX:

- Markdown-блоки не рендерятся — пользователь видит сырой `## Заголовок`.
- Нет горячих клавиш — `Shift+Enter` для запуска ячейки является нормой в этом классе продуктов; без него UX мучительный.
- Перенос ячеек только кнопками `↑/↓` — для длинных ноутбуков это боль; нужен drag-and-drop.
- Нет undo/redo на уровне ноутбука (удалил ячейку — потерял её).
- Нет поиска внутри ноутбука (Ctrl/Cmd+F находит только видимый DOM, что бесполезно при свёрнутых outputs).

Эпик закрывает «второй уровень» UX, на котором продукт начинает чувствоваться нативным.

## User stories

- Как пользователь, я хочу видеть оформленный markdown с подсветкой кода и формулами.
- Как пользователь, я хочу запустить ячейку через `Shift+Enter` и перейти к следующей.
- Как пользователь, я хочу переставлять ячейки drag-and-drop.
- Как пользователь, я хочу `Cmd+Z` после случайного удаления ячейки.
- Как пользователь, я хочу найти подстроку по всему ноутбуку (включая свёрнутые outputs).

## Acceptance criteria

### Markdown rendering

- [ ] Markdown-ячейка в режиме «view» отображается оформленно. По клику → режим «edit».
- [ ] По `Esc` или `Cmd+Enter` — обратно в view + автосейв.
- [ ] Поддержка: заголовки, списки, таблицы (GFM), inline-code, fenced code blocks с подсветкой синтаксиса JS/TS/JSON/HTML/CSS/bash, ссылки, картинки (по URL), цитаты.
- [ ] Поддержка LaTeX: inline `$...$` и block `$$...$$`.
- [ ] Sanitization — никакого raw HTML из markdown в DOM (защита от XSS через шарящиеся ноутбуки).

### Code editor

- [ ] Используем CodeMirror 6 (см. Tech notes — выбор обоснован).
- [ ] Подсветка JS/TS, базовый автокомплит (ключевые слова, локальные идентификаторы).
- [ ] Bracket matching, indent-on-enter, line numbers (toggle в `notebookSettings`).
- [ ] Тема следует за глобальной (light/dark, из `entities/theme`).

### Hotkeys

В фокусе ячейки:

- [ ] `Shift+Enter` — запустить и перейти к следующей (если её нет — создать code-ячейку).
- [ ] `Cmd/Ctrl+Enter` — запустить, остаться на месте.
- [ ] `Alt+Enter` — запустить, вставить новую code-ячейку ниже.
- [ ] `Esc` — выйти из режима редактирования в «command mode».

В command mode (фокус на ячейке, не в редакторе):

- [ ] `A` / `B` — вставить ячейку выше / ниже.
- [ ] `D D` — удалить ячейку (с undo).
- [ ] `M` / `Y` — сменить kind на markdown / code.
- [ ] `↑` / `↓` — переход между ячейками.
- [ ] `Enter` — войти в edit mode.

Глобально:

- [ ] `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` — undo/redo операций над ячейками.
- [ ] `Cmd/Ctrl+F` — открыть поиск по ноутбуку.
- [ ] `?` — показать модалку со всеми шорткатами.

### Drag-and-drop

- [ ] Ячейку можно тянуть за «handle» слева (иконка `::`).
- [ ] Drop-зоны подсвечиваются между ячейками.
- [ ] `Esc` во время drag отменяет операцию.
- [ ] Корректно при scroll длинного ноутбука (auto-scroll при подходе к краю).

### Undo/Redo

- [ ] Стек операций ноутбука хранит **последние 50** действий: add, delete, move, change-kind, edit-source (агрегируется debounce 1с).
- [ ] Изменение outputs / executionCount **не входит** в undo-стек.
- [ ] Очищается при открытии другого ноутбука.

### Поиск

- [ ] `Cmd/Ctrl+F` открывает inline-поиск в шапке ноутбука.
- [ ] Ищет по `source` всех ячеек (case-insensitive, опц. regex).
- [ ] Подсвечивает совпадения, навигация `Enter` / `Shift+Enter`.
- [ ] Показывает счётчик `3/17`.

## Tech notes

### Файлы

```
src/features/notebook/
  ui/
    NotebookCell.tsx              ← рефакторинг под edit/view режимы
    MarkdownView.tsx              ← новый, рендерит markdown
    CodeEditor.tsx                ← новый, обёртка над CodeMirror 6
    CellDragHandle.tsx            ← новый, drag handle + zone
    HotkeysProvider.tsx           ← новый, глобальные шорткаты
    SearchBar.tsx                 ← новый, поиск по ноутбуку
    ShortcutsHelp.tsx             ← новый, модалка справки
  model/
    history.ts                    ← undo/redo стек
    history.test.ts
    cellMode.ts                   ← edit/command mode атом
    search.ts                     ← search state, matches
src/shared/lib/
  hotkeys.ts                      ← хук reatomHotkeys (через @reatom/react)
```

### Markdown

- Стек: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight` (или Shiki, если готовы платить размером бандла).
- DOMPurify в качестве страховки (если включаем `rehype-raw` — не включать; raw HTML отключён by-design).
- KaTeX-стили подгружаем lazy при первом markdown с `$`.

### Code editor

**CodeMirror 6**, не Monaco:

- CM6 ~150 КБ gzip против Monaco ~2 МБ.
- CM6 модулярный — берём только нужные пакеты.
- Monaco тащит web-worker и трудно интегрируется с нашим runtime worker'ом.

Пакеты: `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-javascript`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`, `@codemirror/autocomplete`, `@codemirror/commands`.

### Hotkeys

Минимальный hook без зависимостей: `useHotkeys(scope, bindings)` поверх `keydown`-листенера на documenт + scope-stack (модалки переопределяют). Все хендлеры — `wrap(...)` обязательно (см. [docs/architecture/reatom.md](../architecture/reatom.md), strict async stack).

### Drag-and-drop

- `@dnd-kit/core` + `@dnd-kit/sortable`. Хорошо ложится на ARIA, поддерживает клавиатурный drag (важно для a11y, [Epic 08](./08-quality-and-dx.md)).
- Альтернатива (нативный HTML5 DnD) — отметаем, плохо со скроллом и a11y.

### Undo/Redo

История — обычный `Atom<Operation[]>` + указатель. Каждая операция — `{ kind, payload, inverse }`. `inverse` пересоздаётся в момент применения (тогда мы знаем точный state). Это переживёт reload, если позже захотим персистить (сейчас — нет, очищается на ребут).

### Reatom-замечание

Все обработчики ячеек (`onKeyDown`, drag-handlers, search-handlers), которые вызывают actions, **должны** быть обёрнуты `wrap(...)` — иначе runtime упадёт с `missing async stack` из-за `clearStack()` в `src/setup.ts`. См. AGENTS.md.

## Mock strategy

Эпик чисто клиентский, мок-слой не задействован. Тесты — RTL для hotkeys (`userEvent.keyboard('{Shift>}{Enter}')`), unit для `history.ts`, snapshot для `MarkdownView` с фикстурами.

## Out of scope

- Совместное редактирование (multi-cursor).
- Inline-комментарии к ячейкам.
- AI-автодополнение в редакторе — отдельный эпик за пределами текущего скоупа.
- `Cmd+P` quick-open ноутбуков — [Epic 04](./04-notebook-management.md).

## Dependencies

- [Epic 02](./02-notebook-data-model.md) — undo/redo и autosave опираются на цельную модель ноутбука с детерминированными операциями.
