# Skill: add-page

Add a new page to the JS Notebook app. The app uses **Reatom routing**
(`reatomRoute` + `urlAtom` from `@reatom/core`) — there is **no react-router**
(`<Routes>` / `<Route>` / `useLocation` do not exist here). A page is a folder
under `src/pages/<name>/` with three files, plus one import line in `App.tsx`
and (optionally) one sidebar entry.

See [`docs/architecture/routing.md`](../docs/architecture/routing.md) for the
full routing model; this skill is the step-by-step.

## Usage

Invoke this skill with:

- page name (PascalCase, e.g. `SettingsPage`)
- route path — **relative, no leading slash** (e.g. `settings`, `components/shadcn`, `''` for home)
- whether the page requires a signed-in user (wrap in `AuthRouteGuard`)
- sidebar label + lucide-react icon + nav group, if it should appear in the sidebar

## Conventions you must follow

- **Route paths are RELATIVE** (`'settings'`, not `'/settings'`). They nest
  under `rootRoute`, which carries the app base path (`/` or `/pr-<N>/`).
- **Every link / programmatic URL is base-aware** — prefix with
  `import.meta.env.BASE_URL` (or use the `appPath()` helper in
  `@/shared/lib/paths`). Never hardcode an absolute `/settings`: it breaks under
  a preview base path.

## Steps

### 1. Create the page folder `src/pages/<name>/`

```
src/pages/my-page/
├── index.ts
├── model/route.tsx
└── ui/MyPage.tsx
```

`ui/MyPage.tsx` — the component. Use `reatomComponent` only if it reads atoms:

```tsx
export default function MyPage() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">My page</h1>
      <p className="mt-1 text-sm text-muted-foreground">Description here.</p>
    </div>
  )
}
```

### 2. Register the route in `model/route.tsx`

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

If the page requires a signed-in user, wrap it in `AuthRouteGuard` (like the
notebook / settings / dashboard routes):

```tsx
import { rootRoute } from '@/app/model/routes'
import { AuthRouteGuard } from '@/app/ui/AuthRouteGuard'
import MyPage from '../ui/MyPage'

export const myPageRoute = rootRoute.reatomRoute({
  path: 'my-page',
  render() {
    return (
      <AuthRouteGuard>
        <MyPage />
      </AuthRouteGuard>
    )
  },
})
```

### 3. Re-export from `index.ts`

```ts
export { default as MyPage } from './ui/MyPage'
export { myPageRoute } from './model/route'
```

### 4. Register the page in `src/app/App.tsx`

Import the module so its `reatomRoute(...)` call runs at module-evaluation time
(side-effect import — the route registers itself):

```tsx
import '@/pages/my-page'
```

### 5. (Optional) Add a sidebar entry in `src/app/layouts/AppSidebar.tsx`

Add the lucide icon import if needed, then a nav item to the correct group
array (`navMain`, `navAi`, …). The `url` is **relative**; `NavGroup` prefixes it
with `import.meta.env.BASE_URL`:

```tsx
import { SomeIcon } from 'lucide-react'

const navMain: NavItem[] = [
  { title: 'Notebook', icon: BookText, url: '' },
  { title: 'My page', icon: SomeIcon, url: 'my-page' },
]
```

Active highlighting (`pathname === BASE_URL + item.url`) and SPA navigation are
handled automatically by `urlAtom` — no `useNavigate`, no `e.preventDefault()`.

## Checklist

- [ ] `src/pages/<name>/ui/<PageName>.tsx` created
- [ ] `src/pages/<name>/model/route.tsx` registers the route under `rootRoute` (relative path)
- [ ] `AuthRouteGuard` applied if the page needs a signed-in user
- [ ] `src/pages/<name>/index.ts` re-exports the page + route
- [ ] Side-effect import added to `src/app/App.tsx`
- [ ] (Optional) sidebar nav item added with a RELATIVE `url`
- [ ] Page is visible in the browser at the correct URL (and under `/pr-<N>/` previews)
- [ ] Sidebar highlights the item when on that route

## Notes

- A worked example landed in TARDIS-183: `src/pages/dashboard/`
  (folder layout, `AuthRouteGuard`, sidebar entry, base-aware navigation).
- The root route is a **layout route**: an unmatched URL renders `NotFoundPage`
  via the empty outlet — you do not register a 404 route.
- Reatom routing supports typed params / validated search / loaders
  (`withAsyncData`); see the Reatom skill if a page needs them.
