# Folder Structure

## Top-level layout

```
ui/
├── docs/                  # Project documentation (you are here)
├── public/                # Static assets served as-is (favicon, icons)
├── src/                   # All application source code
├── index.html             # Vite entry HTML — mounts <div id="root">
├── vite.config.ts         # Vite config: plugins, path aliases
├── tsconfig.app.json      # TypeScript config for src/ (strict mode)
├── tsconfig.json          # Root TS config — references tsconfig.app.json
├── tsconfig.node.json     # TypeScript config for Vite config file itself
├── eslint.config.js       # ESLint flat config
├── components.json        # shadcn/ui config (style, aliases, icon library)
├── package.json           # Dependencies and scripts
└── pnpm-lock.yaml         # Locked dependency tree — never edit manually
```

---

## src/ in detail

```
src/
├── assets/                # Images, SVGs, fonts imported into components
├── components/
│   ├── common/            # Your own reusable components
│   │   ├── AppSidebar.tsx     # Sidebar layout with nav groups
│   │   └── NotebookCell.tsx   # The notebook cell component
│   └── ui/                # shadcn/ui generated components — do not edit
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       └── ... (17 components total)
├── hooks/                 # Custom React hooks
│   └── use-mobile.ts          # Detects mobile viewport (from shadcn)
├── lib/                   # Utilities and pure functions
│   ├── utils.ts               # cn() helper — merges Tailwind classes
│   └── executeJS.ts           # Runs JS code, captures console output
├── pages/                 # One file per route
│   ├── NotebookPage.tsx       # / — main notebook interface
│   ├── LoginPage.tsx          # /login
│   ├── ShadcnComponentsPage.tsx  # /components/shadcn
│   ├── CustomComponentsPage.tsx  # /components/custom
│   └── AboutPage.tsx          # /about
├── services/              # External API calls (empty, reserved)
├── store/                 # Global state (empty, reserved)
├── types/                 # Shared TypeScript types (empty, reserved)
├── App.tsx                # Router setup + shared Layout component
├── main.tsx               # React root mount + TooltipProvider wrapper
└── index.css              # Global styles + Tailwind v4 import
```

---

## Key conventions

### `components/ui/` is read-only
shadcn/ui generates component files into this folder. Treat them as a dependency — never edit them directly. If you need to change behaviour, wrap the component in `components/common/` instead.

### `components/common/` is yours
All custom-built components live here. Each file exports one primary component. If a component grows large, split it into a subfolder:
```
components/common/NotebookCell/
├── NotebookCell.tsx
├── CellHeader.tsx
└── CellOutput.tsx
```

### `pages/` = one file per route
Each file in `pages/` corresponds to exactly one URL. Pages orchestrate components but contain no reusable logic — extract that to `hooks/` or `lib/`.

### `lib/` = pure functions only
No React imports in `lib/`. Functions in `lib/` take plain arguments and return plain values. This makes them easy to test in isolation.

---

## shadcn/ui file placement issue

When running `pnpm dlx shadcn@latest add <component>`, shadcn resolves the `@/` alias literally and writes files to a physical `@/` folder in the project root instead of `src/`.

**Fix — always run after adding a shadcn component:**
```bash
cp @/components/ui/*.tsx src/components/ui/
cp @/hooks/*.ts src/hooks/          # if hooks were added
rm -rf "@/"
```

This is a known quirk of using shadcn with Vite + a custom alias that isn't configured in `jsconfig.json`.
