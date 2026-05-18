# Design system

Tokens for the Notion + Observable hybrid direction. Light theme only for now.

## Implementation note

The shadcn token set (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, …) is defined in `src/app/styles/index.css` under `:root`, mapped to Tailwind v4 utilities through an `@theme inline { --color-* : var(--*) }` block. Legacy tokens (`--text`, `--bg`, `--accent`, `--code-bg`) are still defined for the older demo pages but **alias the shadcn tokens** — no new code should consume them.

## Palette (light)

Warm paper background, Notion-grey text, blue primary, Observable-green for run/success.

| Token (shadcn)             | Hex       | Used for                                           |
| -------------------------- | --------- | -------------------------------------------------- |
| `--background`             | `#FBFBFA` | page background (warmer than `#FFF`, Notion-paper) |
| `--foreground`             | `#1F1F1E` | primary text (softer than pure black)              |
| `--card`                   | `#FFFFFF` | card / cell surface                                |
| `--card-foreground`        | `#1F1F1E` | text on cards                                      |
| `--popover`                | `#FFFFFF` | menus, popovers                                    |
| `--popover-foreground`     | `#1F1F1E` | text in popovers                                   |
| `--muted`                  | `#F7F7F5` | sidebar, code-cell background, hover surface       |
| `--muted-foreground`       | `#787774` | captions, metadata, placeholder copy               |
| `--border`                 | `#E9E9E7` | separators, cell borders                           |
| `--input`                  | `#E9E9E7` | input borders                                      |
| `--ring`                   | `#0B6BCB` | focus ring (matches `--primary`)                   |
| `--primary`                | `#0B6BCB` | CTAs, links, active sidebar item                   |
| `--primary-foreground`     | `#FFFFFF` | text on primary                                    |
| `--secondary`              | `#F1F1EE` | secondary surface (output block, raised states)    |
| `--secondary-foreground`   | `#1F1F1E` | text on secondary                                  |
| `--accent`                 | `#F1F1EE` | hover background for ghost buttons / menu items    |
| `--accent-foreground`      | `#1F1F1E` | text on accent                                     |
| `--destructive`            | `#DC2626` | runtime errors, delete confirmations               |
| `--destructive-foreground` | `#FFFFFF` | text on destructive                                |

**Sidebar tokens** (shadcn sidebar uses its own scoped set):

| Token                          | Hex       |
| ------------------------------ | --------- |
| `--sidebar-background`         | `#F7F7F5` |
| `--sidebar-foreground`         | `#1F1F1E` |
| `--sidebar-primary`            | `#0B6BCB` |
| `--sidebar-primary-foreground` | `#FFFFFF` |
| `--sidebar-accent`             | `#F1F1EE` |
| `--sidebar-accent-foreground`  | `#1F1F1E` |
| `--sidebar-border`             | `#E9E9E7` |
| `--sidebar-ring`               | `#0B6BCB` |

**Semantic extras** (not standard shadcn — add as our own):

| Token                  | Hex       | Used for                           |
| ---------------------- | --------- | ---------------------------------- |
| `--success`            | `#0F7B6C` | run-indicator strip, ✓ result icon |
| `--success-foreground` | `#FFFFFF` | text on success                    |
| `--warning`            | `#D9730D` | long-running / draft / unsaved     |
| `--warning-foreground` | `#FFFFFF` | text on warning                    |

## Typography

Stack: **Geist Variable** (already installed via `@fontsource-variable/geist`) for UI/body, **JetBrains Mono Variable** for all code surfaces.

Install JetBrains Mono: `pnpm add @fontsource-variable/jetbrains-mono`, then import once in `src/app/index.tsx`.

| Role                             | Font           | Size / line-height / weight |
| -------------------------------- | -------------- | --------------------------- |
| H1 (notebook title)              | Geist          | 32 / 1.2 / 600              |
| H2 (section heading)             | Geist          | 24 / 1.3 / 600              |
| H3                               | Geist          | 18 / 1.4 / 600              |
| Body / markdown cell             | Geist          | 16 / 1.65 / 400             |
| UI label (sidebar item, toolbar) | Geist          | 13 / 1.4 / 500              |
| Caption / meta                   | Geist          | 12 / 1.4 / 400              |
| Code (cells, inline)             | JetBrains Mono | 14 / 1.55 / 400             |

Body line-height `1.65` is the Notion "breathing room" target. Content max width is `max-w-3xl` (~720px) so code and prose stay around 70 characters per line.

## Spacing & radius

- Spacing scale: Tailwind defaults (`4 8 12 16 24 32 48`). No new spacing tokens.
- Cell-to-cell vertical gap: **24px** (`gap-6`).
- Cell internal padding: **16px** (`p-4`).
- Border radii: cells / inputs `rounded-md` (6px), cards `rounded-lg` (8px), sidebar items `rounded-sm` (4px), modals `rounded-xl` (12px).

## Elevation

Minimal. Cards and cells use border only — **no shadow**. The only shadow is for floating menus / popovers / tooltips:

```
shadow-[0_4px_12px_rgb(15_15_15/0.08)]
```

Use the shadcn primitive's default (`Popover`, `DropdownMenu`, `Tooltip` already set sensible shadows — don't override unless required).

## Motion

- All transitions **150–200ms**, `ease-out` for enter, `ease-in` for exit.
- Hover-toolbar reveal: 150ms opacity fade.
- Run-button → spinner only after 300ms of pending work (avoid spinner flash for fast operations).
- Respect `prefers-reduced-motion` — disable everything except opacity.

## Dark theme

Tokens live under `.dark { … }` in `index.css`. The selector hooks into Tailwind v4 via `@custom-variant dark (&:where(.dark, .dark *))` so any `dark:bg-card` style works. The toggle is `themeAtom` in `src/entities/theme/` (`withLocalStorage('theme')` + `withChangeHook` to toggle the `<html>` class). The initial value is re-applied imperatively in `app/model/setup.ts` — change-hooks don't fire on init.

| Token          | Light     | Dark      |
| -------------- | --------- | --------- |
| `--background` | `#FBFBFA` | `#191919` |
| `--foreground` | `#1F1F1E` | `#E3E3E1` |
| `--card`       | `#FFFFFF` | `#202020` |
| `--muted`      | `#F7F7F5` | `#202020` |
| `--border`     | `#E9E9E7` | `#373737` |
| `--primary`    | `#0B6BCB` | `#5294E2` |
| `--sidebar`    | `#F7F7F5` | `#181818` |

Manual toggle only — `prefers-color-scheme` is not honored. A 3-state toggle (light / dark / system) is an open follow-up.

## Open token decisions

- The legacy `--accent: #aa3bff` (purple, originally in `index.css`) now aliases the shadcn `--accent` (`#F1F1EE`). The original purple identity is effectively retired; if a brand purple is still wanted, define a dedicated `--brand` token rather than reaching for the legacy `--accent`.
