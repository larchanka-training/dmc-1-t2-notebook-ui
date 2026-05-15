# Path Aliases

## What is a path alias?

Without an alias, importing a component from a deeply nested file looks like:

```tsx
import { Button } from '../../../shared/ui/button'
```

This breaks when you move files. With the `@/` alias it becomes:

```tsx
import { Button } from '@/shared/ui/button'
```

`@/` always points to `src/` regardless of where the importing file lives.

---

## Where it's configured

The alias is declared **once**, in `tsconfig.app.json`. Vite reads it from there at runtime; you don't need to repeat it in `vite.config.ts`.

### `tsconfig.app.json` — the single source of truth

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### `vite.config.ts` — opt into native tsconfig resolution

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,   // Vite 8+ reads paths from tsconfig automatically
  },
})
```

Vite 8 supports `resolve.tsconfigPaths` natively — no `vite-tsconfig-paths` plugin needed. The previous version of this project manually duplicated the alias as `resolve.alias`; that duplication is gone, and renaming or adding aliases now only requires editing `tsconfig.app.json`.

---

## Usage in the project

Every internal import uses `@/`:

```tsx
import { NotebookView } from '@/features/notebook'         // feature public API
import { NotebookCell } from '@/features/notebook'         // re-exported via index.ts
import { Button }       from '@/shared/ui/button'          // shadcn primitive
import { cn }           from '@/shared/lib/cn'             // class-merge helper
import { rootRoute }    from '@/app/model/routes'          // app composition
```

Note the layer boundaries:
- Pages import from `@/features/*` and `@/shared/*`
- Features import from `@/shared/*` only
- `shared` imports from nothing internal

---

## The shadcn alias and the `@/` folder quirk

`components.json` tells shadcn/ui where to write generated files:

```json
{
  "aliases": {
    "components": "@/shared",
    "ui":         "@/shared/ui",
    "lib":        "@/shared/lib",
    "hooks":      "@/shared/lib",
    "utils":      "@/shared/lib/cn"
  }
}
```

**Symptom:** after `pnpm dlx shadcn@latest add <c>`, a literal `@/` folder sometimes appears at the project root containing the generated files. This is a shadcn + Vite resolution quirk.

**Fix:**

```bash
mv @/shared/ui/*.tsx src/shared/ui/
rm -rf "@/"
```

See [Folder Structure — shadcn/ui placement](./folder-structure.md#shadcnui-placement) for the full explanation.
