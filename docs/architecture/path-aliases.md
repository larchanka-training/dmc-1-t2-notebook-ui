# Path Aliases

## What is a path alias?

Without an alias, importing a component from a deeply nested file looks like:

```tsx
import { Button } from '../../../components/ui/button'
```

This breaks when you move files. With the `@/` alias it becomes:

```tsx
import { Button } from '@/components/ui/button'
```

`@/` always points to `src/` regardless of where the importing file lives.

---

## Where it's configured

The alias must be declared in **two places** — one for Vite (runtime bundling), one for TypeScript (type checking).

### 1. `vite.config.ts`

```ts
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### 2. `tsconfig.app.json`

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Both must match. If you add the alias to one but not the other, either the build will fail or the editor will show false type errors.

---

## Usage in the project

Every internal import uses `@/`:

```tsx
import { NotebookCell } from '@/components/common/NotebookCell'
import { Button }        from '@/components/ui/button'
import { cn }            from '@/lib/utils'
import { executeJS }     from '@/lib/executeJS'
```

---

## The shadcn alias conflict

shadcn/ui reads the `@/` alias from `components.json` to decide where to write generated files. Due to how it resolves paths with Vite (vs Next.js), it sometimes writes files to a literal `@/` folder in the project root instead of `src/`.

**Symptom:** after running `pnpm dlx shadcn@latest add <component>` you see a new `@/` folder at the root of the project.

**Fix:**
```bash
cp @/components/ui/*.tsx src/components/ui/
rm -rf "@/"
```

See [Folder Structure](./folder-structure.md#shadcnui-file-placement-issue) for the full explanation.
