# Epic 03 — Cell editing UX

> **Статус: реализовано в TARDIS-71.** Эпик закрыт поверх готового runtime
> TARDIS-70. Расхождения плана с фактической реализацией отмечены инлайн
> пометками «**Факт:**».
>
> Ключевые отличия от исходных Tech notes:
>
> - **Markdown** уже базово рендерился до эпика (`react-markdown@10`); эпик
>   добавил GFM, LaTeX (lazy KaTeX), подсветку fenced-кода и закрепил
>   sanitization тестом. `rehype-raw` намеренно не включён, поэтому DOMPurify
>   не понадобился (чистить нечего — raw HTML не парсится).
> - **Undo/redo** реализован in-memory (без Epic 02 persistence): стек
>   операций живёт в памяти и очищается на reload — что совпадает с AC
>   «очищается при открытии другого ноутбука».
> - **Hotkeys** используют собственный `useHotkeys` со scope-stack и флагом
>   `modal`; CM6 держит свои keybindings (`Shift/Cmd/Alt+Enter`, `Esc`) через
>   `Prec.highest`, document-level хоткеи уступают фокусу редактора.

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

- [x] Markdown-ячейка в режиме «view» отображается оформленно. По клику → режим «edit».
- [x] По `Esc` или `Cmd+Enter` — обратно в view. (**Факт:** toggle на `Cmd/Ctrl+E`; автосейв — вне эпика, Epic 02.)
- [x] Поддержка: заголовки, списки, таблицы (GFM), inline-code, fenced code blocks с подсветкой синтаксиса (highlight.js, авто-детект языка), ссылки, картинки (по URL), цитаты.
- [x] Поддержка LaTeX: inline `$...$` и block `$$...$$` (KaTeX, CSS грузится lazy при первом `$`).
- [x] Sanitization — никакого raw HTML из markdown в DOM (`rehype-raw` отключён by-design; покрыто XSS-тестом).

### Code editor

- [x] Используем CodeMirror 6 (см. Tech notes — выбор обоснован).
- [x] Подсветка JS/TS, базовый автокомплит (ключевые слова, локальные идентификаторы).
- [x] Bracket matching, indent-on-enter, line numbers (toggle в `notebookSettings`, кнопка в тулбаре).
- [x] Тема следует за глобальной (light/dark/system, из `entities/theme`, через CM Compartment). (**Факт:** 3-позиционный режим light/dark/system, по умолчанию system; CM-палитра следует за `resolvedThemeAtom`.)

### Hotkeys

В фокусе ячейки:

- [x] `Shift+Enter` — запустить и перейти к следующей (если её нет — создать code-ячейку).
- [x] `Cmd/Ctrl+Enter` — запустить, остаться на месте.
- [x] `Alt+Enter` — запустить, вставить новую code-ячейку ниже.
- [x] `Esc` — выйти из режима редактирования в «command mode» (блюрит редактор, фокус уходит на document).

В command mode (фокус на ячейке, не в редакторе — видимая цветная грань слева: синяя в command, зелёная в edit):

- [x] `A` / `B` — вставить ячейку выше / ниже.
- [x] `D D` — удалить ячейку (с undo).
- [x] `M` / `Y` — сменить kind на markdown / code.
- [x] `↑` / `↓` — переход между ячейками.
- [x] `Enter` — войти в edit mode.

Глобально:

- [x] `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` — undo/redo операций над ячейками.
- [x] `Cmd/Ctrl+F` — открыть поиск по ноутбуку.
- [x] `?` — показать модалку со всеми шорткатами.

### Drag-and-drop

- [x] Ячейку можно тянуть за «handle» слева (иконка `::`).
- [x] Drop-зоны подсвечиваются между ячейками (pill-индикатор со свечением на целевой грани).
- [x] `Esc` во время drag отменяет операцию (встроено в @dnd-kit).
- [x] Корректно при scroll длинного ноутбука (auto-scroll при подходе к краю).

### Undo/Redo

- [x] Стек операций ноутбука хранит **последние 50** действий: add, delete, move, change-kind, edit-source (агрегируется debounce 1с).
- [x] Изменение outputs / executionCount **не входит** в undo-стек.
- [x] Очищается при открытии другого ноутбука. (**Факт:** `clearHistory` экспортирован; in-memory, без persistence — Epic 02.)

### Поиск

- [x] `Cmd/Ctrl+F` открывает inline-поиск в шапке ноутбука.
- [x] Ищет по `source` всех ячеек (case-insensitive, опц. regex).
- [x] Подсвечивает совпадения, навигация `Enter` / `Shift+Enter`. (**Факт:** в code-ячейках совпадения подсвечиваются CM-decoration’ами через `searchHighlightField`, активный match — усиленный стиль + скролл в вид; в markdown-ячейках — скролл без ин-ячеечной подсветки.)
- [x] Показывает счётчик `3/17`.

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
