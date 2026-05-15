# Routing

The app uses **Reatom routing** (`reatomRoute` + `urlAtom` from `@reatom/core`). There is no `react-router`. Routes are atoms: they match the URL reactively, render their own component via a `render` callback, and compose by nesting (`parentRoute.reatomRoute(...)`).

See the [Reatom skill](../../.claude/skills/reatom/SKILL.md) for general framework concepts and [docs/architecture/reatom.md](./reatom.md) for repo-specific conventions.

---

## Route map

| Path | Page component | Source |
|---|---|---|
| `/` | `NotebookPage` | `src/pages/notebook/` |
| `/login` | `LoginPage` | `src/pages/login/` |
| `/components/shadcn` | `ShadcnComponentsPage` | `src/pages/shadcn-components/` |
| `/components/custom` | `CustomComponentsPage` | `src/pages/custom-components/` |
| `/about` | `AboutPage` | `src/pages/about/` |

---

## How it's wired

```
rootRoute (layout: true)                    src/app/model/routes.tsx
  └── render(self) → <AppLayout>{self.outlet()}</AppLayout>
        │
        └── child page routes (registered as side effects when their modules load)
              ├── notebookRoute    path: ''                  → NotebookPage
              ├── loginRoute       path: 'login'             → LoginPage
              ├── aboutRoute       path: 'about'             → AboutPage
              ├── shadcnRoute      path: 'components/shadcn' → ShadcnComponentsPage
              └── customRoute     path: 'components/custom'  → CustomComponentsPage
```

`App.tsx` renders the root and imports each page module so their `reatomRoute(...)` calls register at module-evaluation time:

```tsx
// src/app/App.tsx
import { reatomComponent } from '@reatom/react'
import { rootRoute } from './model/routes'
import '@/pages/notebook'           // registers notebookRoute
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
import { Children } from 'react'
import { reatomRoute } from '@reatom/core'
import { AppLayout } from '../layouts/AppLayout'

export const rootRoute = reatomRoute({
  layout: true,
  render(self) {
    return <AppLayout>{Children.toArray(self.outlet())}</AppLayout>
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

const NavGroup = reatomComponent(({ items }) => {
  const { pathname } = urlAtom()
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            isActive={pathname === item.url}
            render={<a href={item.url} />}
          >
            <item.icon />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
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

**4. (Optional) Add a sidebar entry** in `src/app/layouts/AppSidebar.tsx`:

```tsx
const navMain: NavItem[] = [
  { title: 'Notebook', icon: BookText, url: '/' },
  { title: 'My Page', icon: SomeIcon, url: '/my-page' },
]
```

Active highlighting and SPA navigation work automatically — `urlAtom` handles both.

---

## Route params, search, loaders

For typed params, validated search strings, and loaders with `withAsyncData`, see the [Reatom skill — Routing](../../.claude/skills/reatom/SKILL.md). None of the current pages need them, but the patterns are documented there.
