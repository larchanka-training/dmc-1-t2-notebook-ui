# Folder Structure

This project follows a **fractal / Feature-Sliced** architecture: code is sliced into layers (`app`, `pages`, `features`, `shared`) rather than grouped by file type. See [`.claude/skills/fractal-frontend/SKILL.md`](../../.claude/skills/fractal-frontend/SKILL.md) for the underlying rules.

---

## Top-level layout

```
ui/
├── AGENTS.md             # Agent-facing pointers (read first if you're an AI)
├── CLAUDE.md             # Points at AGENTS.md
├── docs/                 # Project documentation (you are here)
├── public/               # Static assets served as-is
├── src/                  # Application source code
├── index.html            # Vite entry HTML — mounts <div id="root">
├── vite.config.ts        # Vite config (paths via resolve.tsconfigPaths)
├── vitest.config.ts      # Vitest config
├── tsconfig.app.json     # TS config for src/ (paths live here)
├── tsconfig.node.json    # TS config for the Vite config itself
├── tsconfig.json         # Root TS config — references the two above
├── eslint.config.js      # ESLint flat config
├── components.json       # shadcn/ui config — aliases point at @/shared/*
├── Dockerfile            # dev / build / production targets
├── nginx.conf            # nginx config used by the production image
├── package.json
└── pnpm-lock.yaml
```

---

## src/ in detail

```
src/
├── app/                          # Composition root and global setup
│   ├── App.tsx                       # Renders rootRoute, imports page modules to register routes
│   ├── index.tsx                     # createRoot + reatomContext.Provider mount
│   ├── layouts/
│   │   ├── AppLayout.tsx             # Top-level shell (sidebar + content)
│   │   └── AppSidebar.tsx            # Sidebar nav, reads urlAtom for active state
│   ├── model/
│   │   ├── routes.tsx                # rootRoute (layout route hosting outlet)
│   │   └── setup.ts                  # connectLogger() in dev
│   ├── providers/
│   │   └── AppProviders.tsx          # Cross-cutting providers
│   └── styles/
│       └── index.css                 # Global styles + Tailwind v4 import
│
├── entities/                     # Domain entities — state + persistence, no API orchestration
│   └── session/
│       ├── index.ts
│       └── model/session.ts           # tokenAtom, userAtom + setSession/clearSession
│
├── features/                     # Reusable business slices
│   ├── auth/
│   │   ├── index.ts
│   │   ├── model/
│   │   │   ├── auth.ts                # loginAction, logoutAction, loadCurrentUserAction
│   │   │   └── auth.test.ts
│   │   └── ui/LoginForm.tsx
│   └── notebook/
│       ├── index.ts                  # Public API of the slice
│       ├── domain/cell.ts            # Cell factory and types (atomized fields)
│       ├── runtime/                  # Sandboxed execution runtime
│       │   ├── quickjs.ts            # Persistent QuickJS kernel
│       │   ├── worker.ts             # Web Worker entrypoint
│       │   ├── workerHost.ts         # Host facade (runInWorker, Stop, timeout)
│       │   ├── transform.ts          # acorn AST rewrite for shared scope
│       │   ├── interrupt.ts          # SharedArrayBuffer interrupt flag
│       │   ├── serialize.ts          # Safe value serialization
│       │   └── types.ts              # Protocol + OutputItem types
│       ├── model/
│       │   ├── notebook.ts           # cellsAtom + addCell/... CRUD actions
│       │   ├── runtime.ts            # Kernel model: runCell/runAll/stop/restart
│       │   └── notebook.test.ts
│       └── ui/
│           ├── NotebookView.tsx      # List view (reads cellsAtom)
│           ├── NotebookCell.tsx      # Presentational single-cell component
│           ├── OutputView.tsx        # Renders OutputItem[]
│           ├── OutputFrame.tsx       # Sandboxed iframe for HTML output
│           └── NotebookView.test.tsx
│
├── pages/                        # One folder per route
│   ├── notebook/
│   │   ├── index.ts
│   │   ├── model/route.tsx           # rootRoute.reatomRoute({ path: '', render })
│   │   └── ui/NotebookPage.tsx
│   ├── login/                        # same shape: model/route.tsx + ui/LoginPage.tsx
│   ├── about/
│   ├── shadcn-components/
│   └── custom-components/
│
├── shared/                       # Framework-agnostic, no business logic
│   ├── api/                          # HTTP facade — see api-layer.md
│   │   ├── generated/openapi-ts/     # auto-generated types from openapi/*.yaml — do not edit
│   │   ├── client.ts                 # openapi-fetch clients + auth-token middleware
│   │   ├── errors.ts                 # ApiError + 400/401/404 subclasses
│   │   ├── auth.ts                   # login / logout / getMe
│   │   ├── notebook.ts               # list / create / runCell
│   │   └── index.ts                  # public namespace exports (auth, notebook, errors)
│   ├── lib/
│   │   ├── cn.ts                     # cn() — merges Tailwind classes
│   │   └── use-mobile.ts             # Mobile viewport hook (from shadcn)
│   └── ui/                           # shadcn primitives (button, card, sidebar, …)
│
├── test/
│   └── setup.ts                      # Vitest + Testing Library setup
└── setup.ts                          # clearStack() + context.start() — loads first
```

---

## Layer rules

### `app/` — composition only

Wires the application together: render root, layouts, providers, root route. No business logic. Page route modules are imported here purely so their `rootRoute.reatomRoute(...)` calls register the route tree as a side effect.

### `entities/<name>/` — domain state, no orchestration

Reusable domain models with their own state and persistence. An entity owns atoms and the rules for mutating them (e.g. localStorage sync), but does **not** call APIs or orchestrate flows — that's the job of `features/`. Features can import from entities; entities only depend on `shared/`.

Example: `entities/session/` owns `tokenAtom`, `userAtom`, `setSession`, `clearSession`. `features/auth/` calls `shared/api`'s `auth.login()` and then dispatches `setSession({ token, user })`.

### `pages/<name>/` — one route, three files

Each page is a folder with:

- `model/route.tsx` — `rootRoute.reatomRoute({ path, render })`
- `ui/<Name>Page.tsx` — the page component (default export)
- `index.ts` — re-exports the route and the page

Pages compose features and shared UI. They do not host reusable logic — that lives in `features/` or `shared/`.

### `features/<name>/` — domain + model + ui

A self-contained business slice:

- `domain/` — pure types, factories, no React (e.g. `reatomCell`)
- `model/` — atoms, actions, side effects (Reatom)
- `ui/` — components that bind the model to React via `reatomComponent`

External consumers import only from `@/features/<name>` (the public API in `index.ts`), never reach into internals.

### `shared/` — generic primitives

- `shared/ui/` — shadcn/ui design-system components. Treat as a dependency: don't edit, wrap when needed.
- `shared/lib/` — pure helpers (`cn`, hooks). No business knowledge.
- `shared/api/` — HTTP facade over a generated OpenAPI client. Thin domain functions (`auth.login`, `notebook.list`). Framework-agnostic — no Reatom, no React. See [api-layer.md](./api-layer.md). The `generated/` subfolder is auto-generated from `openapi/*.openapi.yaml` and must not be imported from outside `shared/api/` (ESLint enforces it).

No business logic anywhere under `shared/`.

---

## shadcn/ui placement

`components.json` writes shadcn files into `@/shared/*`:

```json
{
  "aliases": {
    "components": "@/shared",
    "ui": "@/shared/ui",
    "lib": "@/shared/lib",
    "hooks": "@/shared/lib",
    "utils": "@/shared/lib/cn"
  }
}
```

If `pnpm dlx shadcn@latest add <c>` still writes to a literal `@/` folder at the project root (a Vite alias resolution quirk), move the files into `src/shared/ui/`:

```bash
mv @/shared/ui/*.tsx src/shared/ui/
rm -rf "@/"
```
