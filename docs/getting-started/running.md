# Running the App

## Development server

```bash
pnpm dev
```

Vite starts on **http://localhost:5173** by default. If that port is taken it auto-increments (`5174`, `5175`, …) and prints the actual URL.

```
VITE v8.0.12  ready in 198ms
➜  Local:   http://localhost:5173/
```

The dev server has **Hot Module Replacement (HMR)** — editing any `.tsx` or `.css` file updates the browser instantly without a full reload.

---

## Available scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the development server with HMR |
| `pnpm build` | Type-check + production build into `dist/` |
| `pnpm preview` | Serve the `dist/` build locally to test production output |
| `pnpm lint` | Run ESLint across all source files |
| `pnpm test` | Run the Vitest suite once (jsdom) |
| `pnpm test:watch` | Run Vitest in watch mode |

---

## Production build

```bash
pnpm build
```

This runs `tsc -b` (type check) followed by `vite build`. Output goes to `dist/`. The build will **fail on TypeScript errors** — fix them before building.

To preview the production build locally:

```bash
pnpm preview
```

---

## Environment

The app currently has no required runtime backend, but a `.env.example` file lists Vite-exposed variables (`VITE_API_BASE_URL`, `VITE_APP_ENV`, `VITE_APP_NAME`). Copy it if you want to override defaults:

```bash
cp .env.example .env
```

Only variables prefixed `VITE_` are exposed to the browser bundle — don't put secrets there. See [CI/CD](../ci-cd.md) for the full list.

---

## Troubleshooting

**Port already in use**
Vite automatically tries the next port. If you want a specific port:
```bash
pnpm dev --port 3000
```

**`pnpm: command not found`**
Install pnpm first:
```bash
npm install -g pnpm
```

**Blank page in browser**
Open DevTools (F12) → Console tab. Most likely a missing import or a component rendering error. The error message will point to the exact file and line.

**HMR not updating**
Hard refresh with `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows). If still broken, stop the server (`Ctrl+C`) and run `pnpm dev` again.

---

## Next step

→ [Architecture: Folder Structure](../architecture/folder-structure.md)
