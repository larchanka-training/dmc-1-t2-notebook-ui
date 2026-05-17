# UI/UX

Design direction and layout plans for the JS Notebook UI.

## Direction (agreed)

- **Reference**: Notion + Observable hybrid — warm light surface, Notion-like generous spacing, Observable/Jupyter-like code cells.
- **Themes**: light (default) + dark. User toggle persists to `localStorage`; `prefers-color-scheme` is not auto-applied.
- **Density**: Notion-like (16px body, 24px gap between cells, 1.65 line-height).
- **Notebook list**: flat (no workspaces / nested groups for now).
- **Navigation shape**: left sidebar with the notebook list, main editor centered (`max-w-3xl`), right outline pane (≥ `xl`) generated from markdown headings.

## Files

- [design-system.md](./design-system.md) — palette, typography, spacing, mapping to shadcn CSS variables.
- [notebook-layout.md](./notebook-layout.md) — layout, cell anatomy, shadcn primitive mapping, implementation phases.

## Status

Done — round 1 (layout foundation):

- **Phase 1** — shadcn theme tokens in `src/app/styles/index.css`, Geist + JetBrains Mono imported in `index.tsx` via `@fontsource-variable/*`.
- **Phase 2** — notebook list moved into `AppSidebar` as a `Notebooks` group (gated on `userAtom`); `NotebookListPanel` deleted.
- **Phase 3** — main editor centered in `max-w-3xl mx-auto`; H1 + subtitle header in `NotebookView`.
- **Phase 4** — `NotebookCell` rebuilt on `Card` + `DropdownMenu` (move / delete) + `Alert` (error) + `Tooltip` (Run hint); hover-only secondary toolbar.
- **Phase 5** — between-cell inserter strip (hover-revealed) + persistent `+ Add cell` at the end.

Done — round 2 (depth):

- **Long notebook list UX** — filter input appears at > 5 notebooks; list scrolls inside `ScrollArea` with `max-h-72`.
- **Markdown cell type** — `kind: 'code' | 'markdown'` on `Cell` domain. Markdown cells render as a sans-serif textarea (no Run button); code cells unchanged. `CellInserter` shows a `DropdownMenu` picker for `Code` / `Text`.
- **Outline pane** — right `<aside>` (hidden < `xl`) with `ScrollArea`, extracts headings from markdown cells via `/^(#{1,6})\s+(.+)$/` regex. Click scrolls the matching cell into view via `data-cell-id` lookup.
- **Dark theme** — `.dark { … }` token block in `index.css`, paired with a Tailwind v4 `@custom-variant dark` selector. `themeAtom` lives in `entities/theme/` with `withLocalStorage('theme')` + `withChangeHook` to toggle `documentElement.classList`. Toggle is a `Switch` in `SidebarFooter`. Initial value is re-applied imperatively in `app/model/setup.ts` since change-hooks don't fire on init.

Done — round 3 (markdown polish):

- **Markdown preview mode** — `react-markdown` installed. `Cell.viewMode: Atom<'edit' | 'preview'>` (default `edit`). Markdown cells show an `Eye` / `Pencil` toggle in the header (with `Tooltip`). Empty content stays in edit even when toggled. Cmd+E inside the textarea jumps to preview; clicking anywhere in the rendered preview returns to edit (cursor re-focuses the textarea via `requestAnimationFrame`). Rendered headings/paragraphs/lists/inline-code/code-blocks/links/blockquotes/hr styled inline via the `components` prop on `ReactMarkdown` using Tailwind utilities. Outline extraction still works off raw text — preview state doesn't affect it.

Known follow-ups (intentionally deferred):

- **Active-notebook routing.** The notebook list in the sidebar and the in-memory `cellsAtom` are not connected — clicking a notebook does nothing. Wiring needs both a route (e.g. `/n/:notebookId`) and a per-notebook cell-store decision (in-memory map vs server fetch).
- **Notebook rename / delete from sidebar.** Requires extending `openapi/notebook.openapi.yaml` (`PATCH`, `DELETE`) and regenerating the client — backend work first.
- **System theme (`prefers-color-scheme`)**. Only manual toggle for now. Auto-mode would need a 3-state toggle (light / dark / system) and a `matchMedia` listener.
- **Cell persistence.** `cellsAtom` (incl. `viewMode`) is in-memory and resets on reload. Local-only persistence via `withLocalStorage` is one option; the cleaner path is a server-backed notebook detail endpoint.
- **GFM extensions for markdown.** `react-markdown` ships only the CommonMark spec. Tables, task lists, autolinks, and strikethrough need the `remark-gfm` plugin.
- **Syntax-highlighted code blocks in markdown.** Currently rendered as plain `<pre><code>` with mono font. `react-syntax-highlighter` (or Shiki) would give per-language colors.
- **`Notebooks` group visibility.** Empty for anonymous users; the `Login` link in the sidebar covers the onboarding path.

## Ground rules

- **No custom UI components.** Reuse shadcn primitives in `src/shared/ui/`. If a primitive is missing, install it via `npx shadcn add <name>` — do not hand-roll.
- **No new tokens outside the design system.** Spacing/colors/radii live in `src/app/styles/index.css` (or its successor). Components consume Tailwind classes that resolve to those tokens.
- **Document changes here.** Any deviation from this plan during implementation should update the relevant file in this folder, not live only in code comments.
