# Notebook layout

Plan for the `/` (notebook) page. Built entirely on shadcn primitives — no custom UI components.

## Target layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Left Sidebar 260px  │   Main (flex, max-w-3xl center)  │ Outline 220px  │
│ ─────────────────── │   ────────────────────────────   │ ─────────────  │
│ ◇ JS Notebook       │   # Welcome notebook             │ On this page   │
│                     │   Last edited 14 May · ⟳ Synced  │                │
│ Navigation          │                                  │ • Intro        │
│   Notebook (active) │   Introduction paragraph here…   │ • Setup        │
│   Components        │                                  │ • Demo         │
│   Login             │   ┌─ ⋮⋮ [1] ─────────── ▶ ⋯ ─┐  │ • Result       │
│   About             │   │ const data = [1, 2, 3]   │  │                │
│                     │   │ console.log(data)        │  │                │
│ Notebooks           │   └──────────────────────────┘  │                │
│   📓 Welcome  •     │   ┌─ Output ─────────────────┐  │                │
│   📓 Scratchpad     │   │ [1, 2, 3]                │  │                │
│   📓 API tests      │   └──────────────────────────┘  │                │
│   + New notebook    │                                  │                │
│ ─────────────────── │   + Add cell  (code · text)      │                │
│ 👤 demo@example.com │                                  │                │
└──────────────────────────────────────────────────────────────────────────┘
```

Three regions: existing left `Sidebar` (extended), `SidebarInset` for the editor centered with `max-w-3xl`, and a right outline pane.

## Region 1 — Left sidebar

Keep the existing `AppSidebar` and add a **Notebooks** group below the navigation groups. Flat list (no workspaces / nested folders) per current scope.

Use these already-installed primitives from `@/shared/ui/sidebar`:

- `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`
- `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`
- `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`
- `SidebarMenuAction` — for the per-notebook `⋯` button (rename / delete)

Sidebar footer: user identity. Use installed `Avatar` + plain text.

**No new components needed for this region.** Replace the current `NotebookListPanel` (which lives at the top of the main editor) with a sidebar group — the panel becomes redundant.

## Region 2 — Main editor

Wrapped by `SidebarInset`. Header row uses `SidebarTrigger` (already in place) plus notebook title + sync indicator. Content area is `<main className="mx-auto w-full max-w-3xl px-6 py-8">`.

### Cell anatomy

```
        gutter (hover)
              │
         ┌────▼──────────────────────────────────┐  ◄─ hover-toolbar
   ⋮⋮ ──┤ [1]  const data = [1,2,3]      ▶ ⋯   │      (Run + DropdownMenu)
         │       console.log(data)               │
         └───────────────────────────────────────┘
         ┌───────────────────────────────────────┐
         │ Output: [1, 2, 3]                     │
         └───────────────────────────────────────┘
```

Mapping to shadcn primitives:

| Element                                   | shadcn primitive                                             | Notes                                                      |
| ----------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Cell shell                                | `Card`                                                       | `bg-card`, `border`, `rounded-md` — minimal shadcn surface |
| Run button                                | `Button` `variant="ghost"` `size="icon"`                     | `Loader2` from lucide while running                        |
| Action menu (`⋯`)                         | `DropdownMenu` + `DropdownMenuItem`                          | **needs install** (see below)                              |
| Run-index `[1]`                           | none (plain `<span>` with `font-mono text-muted-foreground`) | not a component                                            |
| Output block                              | `Card` `size="sm"`                                           | `bg-secondary`, `font-mono`, `whitespace-pre-wrap`         |
| Error output                              | `Alert` `variant="destructive"`                              | replaces the output Card when status === 'error'           |
| Tooltip on icon buttons                   | `Tooltip`                                                    | already installed, wrap each `Button`                      |
| Status badge ("Running", "Idle", "Error") | `Badge`                                                      | optional — current design uses ring color instead          |

States are styled via Tailwind classes on the `Card`:

| State             | Visual                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| idle              | `border` only                                                                                                                  |
| hover             | gutter (`⋮⋮`) + right toolbar fade in (`opacity-0 group-hover:opacity-100 transition-opacity duration-150`)                    |
| focused (editing) | `ring-1 ring-primary`                                                                                                          |
| running           | left strip `before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-primary` + spinner in Run button |
| error             | `ring-1 ring-destructive` + destructive `Alert` instead of normal output                                                       |

### "+ Add cell"

- Between cells: thin hover-revealed strip (`opacity-0 hover:opacity-100 h-2 → on click expands`). Just a styled `Button` `variant="ghost"` `size="sm"` inside a hover-target div — no new primitive.
- At end of notebook: persistent `Button` `variant="outline"` with `Plus` icon, full-width within the content max.
- Type picker (code / text) on click: use `DropdownMenu` from the same install as cell actions.

## Region 3 — Right outline pane

Generated from markdown cell headings in the notebook. List of jumps within the page.

Built with the same shadcn `Sidebar` family, but with `side="right"`:

```tsx
<Sidebar side="right" collapsible="offcanvas">
  <SidebarContent>
    <SidebarGroup>
      <SidebarGroupLabel>On this page</SidebarGroupLabel>
      <SidebarMenu>...</SidebarMenu>
    </SidebarGroup>
  </SidebarContent>
</Sidebar>
```

`SidebarProvider` supports rendering two `Sidebar`s if each has a unique side. The outline pane should:

- Collapse to an icon-only rail on screens `< 1280px`.
- Disappear entirely on mobile (`< 768px`) — outline is desktop-only.
- Wrap its menu in `ScrollArea` (**needs install**) for long notebooks.

## Components to install (shadcn add)

| Component       | Why                                                             | Region      |
| --------------- | --------------------------------------------------------------- | ----------- |
| `dropdown-menu` | cell `⋯` actions; "+ Add cell" type picker                      | Region 2    |
| `scroll-area`   | overflow in left sidebar (long notebook list) and right outline | Region 1, 3 |
| `dialog`        | rename / delete-confirmation modals                             | Region 1, 2 |

Install with:

```bash
cd ui && npx shadcn@latest add dropdown-menu scroll-area dialog
```

Deferred to a later phase (not part of the first layout milestone):

| Component     | Reason to defer                                       |
| ------------- | ----------------------------------------------------- |
| `command`     | ⌘K command palette — full-text search needed first    |
| `popover`     | Quick "+ Add cell" picker — `DropdownMenu` covers MVP |
| `collapsible` | Needed only if we re-introduce workspaces/folders     |

## Implementation phases

1. **Theme tokens** — _done_. shadcn token set + `@theme inline` mapping live in `src/app/styles/index.css`. Geist + JetBrains Mono imported in `src/app/index.tsx` via `@fontsource-variable/*`.
2. **Sidebar notebook list** — _done_. New `Notebooks` group in `AppSidebar` reads `notebookListResource` and is gated on `userAtom`. `NotebookListPanel` deleted. `ScrollArea` not added — `SidebarContent` already scrolls natively.
3. **Main content centering + header** — _done_. `NotebookView` wraps content in `max-w-3xl mx-auto px-6 py-8` with an H1 + subtitle header. Title is a static `JS Notebook` placeholder for now — see "Open layout decisions".
4. **Cell anatomy refresh** — _done_. `NotebookCell` uses `Card` (`size="sm"`) as the shell, `DropdownMenu` (`MoreHorizontal` trigger) for `Move up` / `Move down` / `Delete`, `Tooltip` on the Run button, `Alert` (`variant="destructive"`) for error output, and a thin `before:` strip in `--primary` for the running state.
5. **"+ Add cell" between blocks** — _done_. `CellInserter` renders between cells (hover-revealed strip + small `Button`) and at the end as a persistent `Button variant="outline"`. No type picker yet — only one cell type exists.
6. **Right outline pane** — _done_. Implemented as a plain `<aside>` (not the `Sidebar` family — multiple sidebars under one `SidebarProvider` share open/closed state, which is wrong for a fixed outline). Hidden < `xl`. Auto-hides entirely until the notebook has **at least 2 headings** — outline doesn't earn its 224px otherwise. Uses `ScrollArea`. Outline entries come from a regex pass over markdown cells' raw text; click scrolls the parent cell into view via `[data-cell-id="…"]`.

## Round 2 additions

- **Long-list UX in sidebar** — `NotebooksGroup` adds a `Search`-iconed `Input` filter (only shown at > 5 notebooks) and wraps the menu in `ScrollArea max-h-72`. Filter is case-insensitive substring on `title`.
- **Markdown cell type** — `Cell.kind` (`'code' | 'markdown'`) on the domain. Markdown cells get a sans-serif textarea, no Run button, no `[index]`. `CellInserter` is now wrapped in `reatomComponent` (so `wrap` works during render) and shows a `DropdownMenu` with `Code` / `Text` options.
- **Dark theme** — `.dark { … }` token block in `src/app/styles/index.css`; Tailwind v4 dark variant declared via `@custom-variant dark (&:where(.dark, .dark *))`. `themeAtom` in `src/entities/theme/` persists via `withLocalStorage` and applies via `withChangeHook` (initial value applied imperatively in `app/model/setup.ts`). Toggle is a `Switch` inside `SidebarFooter`.

## Round 3 additions — markdown preview

- **`Cell.viewMode: Atom<'edit' | 'preview'>`** — added to the `Cell` domain. Default is `'edit'`. Toggle is per-cell and lives in the cell atom (atomization pattern from the Reatom skill — not a global UI state).
- **Header toggle button** — `NotebookCell` shows an `Eye` icon while editing and a `Pencil` icon while previewing, both wrapped in `Tooltip` with the `⌘+E` hint.
- **Empty cells stay in edit** — `showPreview` requires `code.trim().length > 0`. Toggling preview on an empty cell is a no-op so the user never sees a blank panel.
- **Click-to-edit** — the rendered preview is a `<button type="button">` (semantic, full-width). Clicking it switches `viewMode` back to `'edit'` and re-focuses the textarea via `requestAnimationFrame`.
- **Keyboard** — `Cmd+E` / `Ctrl+E` inside the markdown textarea switches to preview. `Cmd+Enter` is unchanged (still only runs code cells).
- **Renderer** — `react-markdown` with a `components` prop mapping `h1`-`h4`, `p`, `ul`/`ol`/`li`, `a`, `code` (inline vs `language-*` block), `blockquote`, `hr` to Tailwind-styled tags. CommonMark only — no GFM tables / strikethrough / task lists yet.
- **Outline is unaffected** — heading extraction reads `cell.code()` (raw text), so toggling preview has no impact on the right-pane outline.

## Round 4 additions — Epic 03 cell-editing UX (TARDIS-71)

This round supersedes several Round 2/3 notes above (kept as history): code
cells are no longer a `<textarea>`, markdown is no longer CommonMark-only, and
`Cmd+Enter` is no longer the only run key.

- **Code editor is CodeMirror 6** — `CodeEditor` replaces the code `<textarea>`: JS/TS highlight, basic autocomplete, bracket matching, indent-on-enter, optional line numbers (toolbar `Hash` toggle → `lineNumbersAtom`). The view is created once and driven through refs/compartments so it survives StrictMode and re-renders. Markdown cells keep the sans-serif textarea + preview.
- **Editor theme follows the app** — `codemirror/theme.ts` maps `resolvedThemeAtom` to a CM extension (one-dark palette in dark, default highlight in light) via a `Compartment`, using design tokens (no hard-coded colours).
- **Markdown++** — `MarkdownView` now runs `remark-gfm` (tables, strikethrough, task lists), `remark-math` + `rehype-katex` (LaTeX, KaTeX CSS lazy-loaded on first `$`), and `rehype-highlight` (fenced-code syntax highlight). `rehype-raw` stays **off** by design — raw HTML is escaped to text, locked by an XSS test.
- **Modal editing (Jupyter-style)** — a focused cell is in **command** mode (blue left bar) or **edit** mode (green left bar), tracked by `cellMode.ts` (`activeCellIdAtom` + `cellModeAtom`). The bar colour is driven by `active` + `mode` props on `NotebookCell`. Clicking the cell shell enters command mode; clicking inside the editor stays in edit (the row click handler ignores clicks on an editable target).
- **Hotkeys** — `shared/lib/hotkeys.ts` provides a document-level scope stack (`useHotkeys`). Edit mode: `Shift+Enter` (run + next), `Cmd/Ctrl+Enter` (run + stay), `Alt+Enter` (run + insert below), `Esc` (→ command, blurs the editor). Command mode (`commandHotkeys.ts`): `A`/`B` insert, `D D` delete, `M`/`Y` change kind, `↑`/`↓` move focus, `Enter` edit. Global: `Cmd/Ctrl+Z` / `Shift+Z`, `Cmd/Ctrl+F`, `?` (cheat-sheet dialog, `ShortcutsHelp`, mounted once in `AppLayout`).
- **Drag-and-drop reorder** — `@dnd-kit` `DndContext`/`SortableContext` in `NotebookView`; `CellDragHandle` renders the `⋮⋮` grip on the left gutter. Drop zones show a pill indicator, `Esc` cancels, the page auto-scrolls near the edge, and a keyboard sensor makes it accessible. `onDragEnd` → `moveCellTo`.
- **Undo/redo** — in-memory stack in `model/history.ts` (last 50 ops: add/delete/move/change-kind/edit-source, source edits coalesced per cell within 1s). Output/`executionCount` are excluded. CodeMirror keeps **no** own history — the notebook stack is the single owner of `Cmd/Ctrl+Z`, so one press is one notebook-level step even while typing.
- **Notebook search** — `model/search.ts` + `SearchBar` in the header (`Cmd/Ctrl+F`): case-insensitive or regex search over every cell `source`, an `n/m` counter, `Enter`/`Shift+Enter` navigation, scroll-to-match. Matches inside code cells are highlighted via a CodeMirror decoration field; the subscription is isolated in `CodeCellEditor` so typing in the search box doesn't re-render whole cells.
- **Theme toggle is now 3-way** — `themeModeAtom` (`light`/`dark`/`system`, default `system`, persisted) resolves to `resolvedThemeAtom`; the sidebar footer renders a `radiogroup` of Light/System/Dark instead of the old `Switch`.

## Open layout decisions

- **Markdown cell support timing.** Outline pane and "+ Add cell text" require it. Current `NotebookCell` is code-only. Either add markdown cells together with phase 4, or postpone phase 6.
- **Sync indicator copy and placement.** "Synced 14 May 12:04" vs "Saved" vs an icon-only status — depends on whether sync is implicit (autosave) or manual (sync button).
- **Mobile editing.** Plan above assumes read-only on mobile (no editor toolbar). If editing is in scope, the right outline goes away and the left sidebar needs a `Sheet`-based drawer (already installed).
- **Dark theme trigger.** Manual `Switch` in sidebar footer vs system `prefers-color-scheme`. Tokens for dark are not yet defined.
