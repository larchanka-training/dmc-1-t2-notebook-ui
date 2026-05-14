# Routing

The app uses **React Router v7** with a browser-history strategy (`BrowserRouter`).

---

## Route map

| Path | Component | Description |
|---|---|---|
| `/` | `NotebookPage` | Main notebook — default landing page |
| `/login` | `LoginPage` | Login form UI example |
| `/components/shadcn` | `ShadcnComponentsPage` | shadcn/ui component gallery |
| `/components/custom` | `CustomComponentsPage` | Custom component showcase |
| `/about` | `AboutPage` | Project and course info |

---

## How it's wired — App.tsx

```
BrowserRouter
└── Routes
    └── Route path="/*"  →  Layout
        ├── AppSidebar
        └── SidebarInset
            ├── header (SidebarTrigger)
            └── Routes                   ← nested routes rendered here
                ├── /                → NotebookPage
                ├── /login           → LoginPage
                ├── /components/shadcn  → ShadcnComponentsPage
                ├── /components/custom  → CustomComponentsPage
                └── /about           → AboutPage
```

The `Layout` component wraps every page. It renders the sidebar and header once, and swaps only the inner content via `<Routes>`.

---

## The Layout component

```tsx
function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <SidebarTrigger />
        </header>
        <div className="flex flex-col flex-1 overflow-auto">
          <Routes>
            {/* routes go here */}
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

`SidebarInset` is a shadcn component that handles the layout relationship between the sidebar and the main content area.

---

## Sidebar navigation

The sidebar uses `useLocation` and `useNavigate` from React Router to:

1. **Highlight** the active nav item — `isActive={location.pathname === item.url}`
2. **Navigate** without a full page reload — `onClick` calls `navigate(url)` instead of following the `href`

```tsx
<SidebarMenuButton
  isActive={location.pathname === item.url}
  render={<a href={item.url} onClick={(e) => { e.preventDefault(); navigate(item.url) }} />}
>
  <item.icon />
  <span>{item.title}</span>
</SidebarMenuButton>
```

The `href` is kept on the `<a>` tag so that right-click → "Open in new tab" and `Cmd+Click` still work correctly.

---

## Adding a new page

Three steps:

**1. Create the page component**
```
src/pages/MyNewPage.tsx
```

```tsx
export default function MyNewPage() {
  return <div className="p-8">My new page</div>
}
```

**2. Add the route in `App.tsx`**
```tsx
import MyNewPage from '@/pages/MyNewPage'

// inside <Routes>:
<Route path="/my-new-page" element={<MyNewPage />} />
```

**3. Add it to the sidebar in `AppSidebar.tsx`**
```tsx
const navMain = [
  { title: 'Notebook', icon: BookText, url: '/' },
  { title: 'My New Page', icon: SomeIcon, url: '/my-new-page' },
]
```

That's it — the sidebar highlight and navigation work automatically.
