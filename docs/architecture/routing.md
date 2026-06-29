# Routing

The app uses **Reatom routing** (`reatomRoute` + `urlAtom` from `@reatom/core`). There is no `react-router`. Routes are atoms: they match the URL reactively, render their own component via a `render` callback, and compose by nesting (`parentRoute.reatomRoute(...)`).

See the [Reatom skill](../../.claude/skills/reatom/SKILL.md) for general framework concepts and [docs/architecture/reatom.md](./reatom.md) for repo-specific conventions.

---

## Base path & previews (important — don't hardcode absolute paths)

The app can be served under a **path prefix** — `/` normally, `/pr-<N>/` for
per-PR previews (one CloudFront/S3 hosts every PR under its own prefix, see
`docs/preview-v2.md` in the monorepo). To make the **same build** work under any
prefix:

- **Vite `base`** comes from `VITE_BASE` at build time (`vite.config.ts`:
  `base: process.env.VITE_BASE ?? '/'`). It drives asset URLs and
  `import.meta.env.BASE_URL` (`'/'` or `'/pr-42/'`, always trailing-slashed).
- **The root route takes its path from `BASE_URL`** (`src/app/model/routes.tsx`),
  so every nested route composes under the prefix automatically.

**Convention:**

- **Route definitions are RELATIVE** (no leading slash): `'login'`, `'about'`,
  `''` for home. They nest under `rootRoute`, which carries the base.
- **Every link / `<a href>` / programmatic URL must be base-aware** — prefix it
  with `import.meta.env.BASE_URL`. **Never** write an absolute `/login`: it works
  at `/` but breaks under `/pr-42/` (navigates out of the preview, active-state
  never matches).

> This bit us once: the sidebar had hardcoded `/login`, `/about` … — fixed to
> `import.meta.env.BASE_URL + url`. Keep `NavItem.url` relative.

---

## Route map

| Path                 | Page component         | Source                         |
| -------------------- | ---------------------- | ------------------------------ |
| `/`                  | `NotebookPage`         | `src/pages/notebook/`          |
| `/dashboard`         | `DashboardPage`        | `src/pages/dashboard/`         |
| `/login`             | `LoginPage`            | `src/pages/login/`             |
| `/components/shadcn` | `ShadcnComponentsPage` | `src/pages/shadcn-components/` |
| `/components/custom` | `CustomComponentsPage` | `src/pages/custom-components/` |
| `/about`             | `AboutPage`            | `src/pages/about/`             |
| `/usage`             | `UsagePage`            | `src/pages/usage/`             |
| `/settings`          | `SettingsPage`         | `src/pages/settings/`          |
| `/llm-playground`    | `LlmPlaygroundPage`    | `src/pages/llm-playground/`    |
| _any unknown URL_    | `NotFoundPage` (404)   | `src/pages/not-found/`         |

`/about` and `/usage` are public (no `AuthRouteGuard`); the rest of the
feature pages — including `/settings`, which holds per-user preferences
namespaced by user id, and `/dashboard`, which lists the signed-in user's
notebooks — stay behind it. The 404 row is not a registered route — it is the
root layout's fallback when no child route matches (see below).

The sidebar's **All notebooks** item (Workspace group) links to `/dashboard`;
it is the start screen the per-user `startView` setting can select (TARDIS-183).

---

## How it's wired

```
rootRoute (layout: true)                    src/app/model/routes.tsx
  └── render(self) → <AppLayout>{outlet().length ? outlet() : <NotFoundPage/>}</AppLayout>
        │
        └── child page routes (registered as side effects when their modules load)
              ├── notebookRoute    path: ''                  → NotebookPage
              ├── dashboardRoute   path: 'dashboard'         → DashboardPage (guarded)
              ├── loginRoute       path: 'login'             → LoginPage
              ├── aboutRoute       path: 'about'             → AboutPage (public)
              ├── usageRoute       path: 'usage'             → UsagePage (public)
              ├── settingsRoute    path: 'settings'          → SettingsPage (guarded)
              ├── llmPlaygroundRoute path: 'llm-playground'  → LlmPlaygroundPage
              ├── shadcnRoute      path: 'components/shadcn' → ShadcnComponentsPage
              └── customRoute     path: 'components/custom'  → CustomComponentsPage
        (no child matches → empty outlet → NotFoundPage)
```

`App.tsx` renders the root and imports each page module so their `reatomRoute(...)` calls register at module-evaluation time:

```tsx
// src/app/App.tsx
import { reatomComponent } from '@reatom/react'
import { rootRoute } from './model/routes'
import '@/pages/notebook' // registers notebookRoute
import '@/pages/login'
import '@/pages/about'
import '@/pages/shadcn-components'
import '@/pages/custom-components'

const App = reatomComponent(() => rootRoute.render(), 'App')
export default App
```

The root route is a **layout route** — it renders on any match and uses `self.outlet()` to mount the currently matched child:

```tsx
// src/app/model/routes.tsx
import { reatomRoute } from '@reatom/core'
import { AppLayout } from '../layouts/AppLayout'

// '/' normally, '/pr-42/' under a preview → '' or 'pr-42'. Child routes nest
// under this, so the whole app composes under the base path.
const basePath = import.meta.env.BASE_URL.replace(/^\/|\/$/g, '')

export const rootRoute = reatomRoute({
  path: basePath,
  layout: true,
  render(self) {
    // `outlet()` holds the rendered children of the matched child route. When
    // NO child matches (an unknown URL under the base path) it is empty — render
    // the 404 page instead of a blank shell. The exact base URL is owned by the
    // notebook route (path ''), so an empty outlet is a genuine no-match.
    const children = self.outlet()
    const content = children.length > 0 ? children : <NotFoundPage />
    return <AppLayout>{content}</AppLayout>
  },
})
```

`AppLayout` is the visual shell (sidebar + content area), not the route logic:

```tsx
// src/app/layouts/AppLayout.tsx
export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <SidebarTrigger />
        </header>
        <div className="flex flex-col flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

---

## Sidebar navigation

`AppSidebar` reads `urlAtom()` for the active path. Navigation is handled by `urlAtom`'s built-in `catchLinks` — a plain `<a href={...}>` is intercepted and turned into SPA navigation. No `useNavigate`, no manual `e.preventDefault()`.

```tsx
// src/app/layouts/AppSidebar.tsx
import { urlAtom } from '@reatom/core'
import { reatomComponent } from '@reatom/react'

// NavItem.url is RELATIVE ('', 'login', 'about', …). The href is base-prefixed
// so it stays inside the deployed base path (see "Base path & previews" above).
const NavGroup = reatomComponent(({ items }) => {
  const { pathname } = urlAtom()
  return (
    <SidebarMenu>
      {items.map((item) => {
        const href = import.meta.env.BASE_URL + item.url
        return (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton isActive={pathname === href} render={<a href={href} />}>
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}, 'NavGroup')
```

---

## Adding a new page

Three steps:

**1. Create the page folder** under `src/pages/<name>/`:

```
src/pages/my-page/
├── index.ts
├── model/route.tsx
└── ui/MyPage.tsx
```

`ui/MyPage.tsx`:

```tsx
export default function MyPage() {
  return <div className="p-8">My new page</div>
}
```

**2. Register the route** in `model/route.tsx`:

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

`index.ts`:

```ts
export { default as MyPage } from './ui/MyPage'
export { myPageRoute } from './model/route'
```

**3. Import the page in `src/app/App.tsx`** so the route registers at startup:

```tsx
import '@/pages/my-page'
```

**4. (Optional) Add a sidebar entry** in `src/app/layouts/AppSidebar.tsx` — use a
**relative** `url` (no leading slash); the href is base-prefixed in `NavGroup`:

```tsx
const navMain: NavItem[] = [
  { title: 'Notebook', icon: BookText, url: '' },
  { title: 'My Page', icon: SomeIcon, url: 'my-page' },
]
```

Active highlighting and SPA navigation work automatically — `urlAtom` handles
both. (Relative `url` is required so it works under a preview base path.)

---

## Route params, search, loaders

For typed params, validated search strings, and loaders with `withAsyncData`, see the [Reatom skill — Routing](../../.claude/skills/reatom/SKILL.md). None of the current pages need them, but the patterns are documented there.
