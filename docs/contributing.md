# Contributing

## Workflow

All work happens on feature branches. Never commit directly to `main`.

```bash
git checkout -b feature/your-feature-name
# ... make changes ...
git push origin feature/your-feature-name
# open a Pull Request
```

---

## Adding a new page

Pages live under `src/pages/<name>/` in a three-file shape (see [Routing](./architecture/routing.md) for the full walkthrough):

```
src/pages/my-page/
├── index.ts
├── model/route.tsx
└── ui/MyPage.tsx
```

1. **Create the page component** in `ui/MyPage.tsx`:

```tsx
export default function MyPage() {
  return <div className="p-8">Content here</div>
}
```

2. **Register the route** in `model/route.tsx`:

```tsx
import { rootRoute } from '@/app/model/routes'
import MyPage from '../ui/MyPage'

export const myPageRoute = rootRoute.reatomRoute({
  path: 'my-page',
  render() {
    return <MyPage />
  },
})
```

3. **Re-export from `index.ts`** and **import the module in `src/app/App.tsx`** so the route registers at startup:

```tsx
// src/app/App.tsx
import '@/pages/my-page'
```

4. **Add it to the sidebar** in `src/app/layouts/AppSidebar.tsx`:

```tsx
const navMain: NavItem[] = [
  { title: 'My Page', icon: SomeIcon, url: '/my-page' },
]
```

5. **Add it to the docs** — create `docs/<topic>/my-page.md`.

---

## Adding a shadcn component

```bash
pnpm dlx shadcn@latest add <component>
```

shadcn is configured (`components.json`) to write into `@/shared/*`. If a literal `@/` folder appears at the project root, move the files in:

```bash
mv @/shared/ui/*.tsx src/shared/ui/
rm -rf "@/"
```

Then import via:

```tsx
import { Dialog } from '@/shared/ui/dialog'
```

Document it in `docs/components/shadcn.md`.

---

## Adding a custom component

Where the component goes depends on its scope:

| Scope | Location |
|---|---|
| Reused across the whole app, no business logic | `src/shared/ui/MyComponent.tsx` |
| Belongs to a specific feature | `src/features/<feature>/ui/MyComponent.tsx` |
| Belongs to a specific page only | `src/pages/<page>/ui/MyComponent.tsx` (or inline in the page file) |

Use **named exports** in `shared/` and `features/`. Page-level files in `pages/<name>/ui/` use a **default export** for the page itself (referenced by `model/route.tsx`).

Example feature component:

```tsx
// src/features/notebook/ui/MyComponent.tsx
export interface MyComponentProps {
  label: string
}

export function MyComponent({ label }: MyComponentProps) {
  return <div>{label}</div>
}
```

Re-export it from the feature's public API in `index.ts` so external consumers don't reach into internals.

Document any reusable component in `docs/components/custom.md` — include props table and usage example.

---

## State, routing, forms — use Reatom

This project uses Reatom for state, async data, routing, and forms. Before reaching for `useState`, `useReducer`, `useEffect`-fetch, `react-router-dom`, or hand-rolled form state, read:

- [Reatom conventions in this repo](./architecture/reatom.md) — especially `wrap` around event handlers
- [`.claude/skills/reatom/SKILL.md`](../.claude/skills/reatom/SKILL.md) — full framework reference

---

## Code style

| Rule | Detail |
|---|---|
| **Default export only for pages** | Use named exports in `features/` and `shared/`. Default exports only for `pages/<name>/ui/<Name>Page.tsx`. |
| **No comments explaining what** | Code should be self-documenting. Comment the *why* only when non-obvious. |
| **Tailwind only** | No inline `style={{}}` except for dynamic values (e.g. computed heights). |
| **`cn()` for conditional classes** | Use `cn()` from `@/shared/lib/cn` instead of template literals. |
| **No `any`** | Use `unknown` and narrow types instead. |
| **Wrap React handlers calling Reatom** | `onClick={wrap(() => action())}` — `clearStack()` is enabled, see [reatom.md](./architecture/reatom.md). |

---

## Tests

Vitest + Testing Library. Tests live next to the file they cover, named `*.test.ts(x)`.

```bash
pnpm test            # run once
pnpm test:watch      # watch mode
```

---

## Adding documentation

Docs live in `docs/`. Each topic has its own folder. To add a new doc:

1. Create the `.md` file in the right folder (or create a new folder)
2. Use clear headings and code blocks
3. Cross-link to related docs with relative paths: `[Routing](../architecture/routing.md)`

No configuration file needs updating — docs are just markdown files.

---

## Checklist before opening a PR

- [ ] `pnpm build` passes with no TypeScript errors
- [ ] `pnpm lint` passes with no warnings
- [ ] `pnpm test` passes
- [ ] The feature works in the browser (visit the page, test the interaction)
- [ ] New components are showcased in `CustomComponentsPage` or `ShadcnComponentsPage`
- [ ] New docs are added if the change introduces a new concept

---

## Docs index

| Topic | Files |
|---|---|
| Getting started | `docs/getting-started/overview.md` · `installation.md` · `running.md` |
| Architecture | `docs/architecture/folder-structure.md` · `routing.md` · `path-aliases.md` · `reatom.md` |
| Notebook | `docs/notebook/how-it-works.md` · `adding-cells.md` |
| Components | `docs/components/shadcn.md` · `custom.md` |
| Contributing | `docs/contributing.md` |
| CI/CD | `docs/ci-cd.md` |
