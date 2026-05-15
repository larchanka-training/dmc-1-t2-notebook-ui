# Skill: add-page

Add a new page to the JS Notebook app. This involves three files every time:
the page component, the route registration, and the sidebar nav entry.

## Usage

Invoke this skill with:

- page name (PascalCase, e.g. `SettingsPage`)
- route path (e.g. `/settings`)
- sidebar label (e.g. `Settings`)
- sidebar icon name from lucide-react (e.g. `Settings`)
- which nav group in the sidebar: `Workspace`, `Components`, or `Auth`

## Steps

### 1. Create the page file

Create `src/pages/{PageName}.tsx`:

```tsx
export default function {PageName}() {
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold">{Label}</h1>
      <p className="text-muted-foreground mt-1 text-sm">Description here.</p>
    </div>
  )
}
```

### 2. Register the route in `src/App.tsx`

Add the import at the top:

```tsx
import { PageName } from '@/pages/{PageName}'
```

Add the route inside `<Routes>`:

```tsx
<Route path="{route}" element={<{PageName} />} />
```

### 3. Add to sidebar in `src/components/common/AppSidebar.tsx`

Add the icon import if not already present:

```tsx
import { {Icon} } from 'lucide-react'
```

Add the nav item to the correct group array:

```tsx
{ title: '{Label}', icon: {Icon}, url: '{route}' },
```

## Checklist

- [ ] `src/pages/{PageName}.tsx` created
- [ ] Import added to `src/App.tsx`
- [ ] `<Route>` added inside `<Routes>` in `src/App.tsx`
- [ ] Nav item added to correct group in `AppSidebar.tsx`
- [ ] Page is visible in the browser at the correct URL
- [ ] Sidebar highlights the item when on that route

## Notes

- The sidebar uses `useLocation().pathname === item.url` for active highlighting — the `url` must exactly match the route `path`
- Pages are lazy-loadable in the future by wrapping imports with `React.lazy()`
- See `docs/architecture/routing.md` for the full routing explanation
