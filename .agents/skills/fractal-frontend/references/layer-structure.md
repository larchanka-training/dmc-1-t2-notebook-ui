# Layer Structure Reference

Detailed folder structures, code examples, and naming conventions for
each layer. Use this reference when creating, reviewing, or reorganizing
project structure.

---

## App Layer

Application shell: providers, routing, layouts, global styles, entry
point. Organized by segments — no slices.

```text
app/
  layouts/         ← Layout wrappers (sidebar + outlet, auth layout, etc.)
  providers/       ← Global providers (state, theme, etc.)
  styles/          ← Global CSS, reset, theme variables
  router.tsx       ← Route configuration (or per framework convention)
  app.tsx          ← Root component
```

Routing is framework-specific. It can live in `app/` directly or follow
framework conventions:

- **Vite + any router**: `app/router.tsx`
- **TanStack Router (file-based)**: `routes/` at src root
- **Next.js App Router**: `app/` at project root

When the framework manages route files, they are **thin** — only routing
config, params, guards. They import and render page components.

```typescript
// Thin route file (framework-managed)
// routes/$workspaceSlug/projects/index.tsx
export const Route = createFileRoute('/$ws/projects/')({
  component: ProjectListPage,
});
```

**Layouts** live in `app/layouts/`. They define the page shell.

```typescript
// app/layouts/app-layout.tsx
export function AppLayout({ children }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

**Belongs in app:** Global providers, routing, layouts, global styles,
error boundaries, analytics initialization.

**Does not belong:** Feature-specific code, business logic, forms.

---

## Pages Layer

Screens bound to routes. Pages **compose** features and widgets — they
are not the default home for business logic. But pages CAN own:

- Route-level orchestration between features (page facade, loader glue).
- Page-scoped state that doesn't belong to any single feature.
- Pure presentational UI used only on this page.

A page slice groups pages by domain. One slice may contain several page
components:

```text
pages/
  auth/                       ← Slice
    ui/
      login-page.tsx          ← Thin: renders <LoginForm /> from features/auth
      signup-page.tsx
    index.ts
  issues/                     ← Slice
    ui/
      issue-list-page.tsx     ← Composes features/issue-tracker
      issue-board-page.tsx
    index.ts
  landing/                    ← Slice
    ui/
      landing-page.tsx
      hero.tsx                ← Page-only UI, no logic
      features-grid.tsx       ← Page-only UI, no logic
    index.ts
```

### Example: page composing features

```typescript
// pages/issues/ui/issue-list-page.tsx
import { IssueList, FilterBar } from '@/features/issue-tracker';
import { Header } from '@/widgets/header';

export function IssueListPage() {
  return (
    <>
      <Header />
      <FilterBar />
      <IssueList />
    </>
  );
}
```

### Example: page-only UI

```typescript
// pages/landing/ui/hero.tsx — no logic, lives only here
export function Hero() {
  return (
    <section className="py-24">
      <h1 className="text-4xl font-bold">Plan. Track. Ship.</h1>
      <p>Linear-style task tracking.</p>
      <CtaButton />
    </section>
  );
}
```

**Belongs in pages:** Route-level composition, page-only presentational
UI, orchestration between features that doesn't belong in any single
feature.

**Does not belong:** Forms with business validation, data fetching for
domain entities, state shared beyond the page. Those belong in features
or entities.

---

## Widgets Layer

Composite UI blocks reused across **multiple pages**. Add only when the
same composition appears in 2+ pages.

```text
widgets/
  header/
    ui/
      header.tsx
      navigation.tsx
      user-menu.tsx
    model/
      header.ts
    index.ts
  sidebar/
    ui/
      sidebar.tsx
    model/
      sidebar.ts
    index.ts
```

A widget composes features and entities and can own composition logic:

```typescript
// widgets/product-catalog/ui/product-catalog.tsx
import { ProductList, FilterPanel } from '@/features/catalog';
import { AddToCartButton } from '@/features/cart';
import { ProductCard } from '@/entities/product';

export function ProductCatalog() {
  return (
    <>
      <FilterPanel />
      <ProductList
        renderProduct={(p) => (
          <ProductCard
            product={p}
            actions={<AddToCartButton product={p} />}
          />
        )}
      />
    </>
  );
}
```

**Belongs in widgets:** Navigation bars, sidebars, dashboards — complex
blocks combining data from multiple entities/features, reused across
pages.

**Does not belong:** Simple UI primitives (→ `shared/ui/`), single-use
page sections (→ keep in page).

---

## Features Layer

**The default home for new business code.** Features — cohesive
product blocks with their own state, logic, and UI.

> A feature is a cohesive product block, NOT a micro use-case. See
> SKILL.md section 3 for the coherence criterion (shared domain +
> shared user-flow + single product name).

```text
features/
  auth/                        ← One feature: login + signup + recovery
    common/
      model/
        auth-session.ts        ← Shared across sub-features
    modules/
      login/
        ui/
          login-form.tsx
        model/
          login.ts
        index.ts
      signup/
        ui/
          signup-form.tsx
        model/
          signup.ts
        index.ts
      recovery/
        ui/
          recovery-form.tsx
        model/
          recovery.ts
        index.ts
    index.ts
  issue-tracker/               ← One feature: list + board + detail
    common/
      domain/
        issue-filter.types.ts
      model/
        issue-filter.ts
    modules/
      issue-list/
      issue-board/
      issue-detail/
    ui/
      issue-tracker-shell.tsx
    index.ts
  cart/                        ← One feature: view, update, trigger checkout
    domain/
      cart.types.ts
    model/
      cart.ts
    ui/
      cart-button.tsx
      cart-drawer.tsx
    index.ts
```

Features grow fractally. A simple feature is flat; a complex one gets
`common/` + `modules/`. See `references/feature-anatomy.md` and
`references/fractal-nesting.md`.

**Belongs in features:** Features with state, business logic, and UI.
Use-cases (create-X, delete-X, apply-filter) are files inside features
or sub-features — never top-level folders.

**Does not belong:** Cross-feature domain data (→ `entities/`), pure
infrastructure (→ `shared/`), UI primitives (→ `shared/`), one-off page
UI without logic (→ `pages/`).

---

## Entities Layer

Reusable business modules. Two triggers:

1. **Pragmatic** — used by 2+ features.
2. **Intentional** — team deliberately isolates the domain concept.

Entities can contain domain data, services, business logic, and domain
UI. Prefer the pragmatic trigger; use intentional extraction sparingly.

```text
// Minimal entity — model only
entities/user/
  model/
    user.ts
  index.ts

// Entity with all segments
entities/product/
  domain/
    product.types.ts
    product.mapper.ts
  model/
    product.store.ts        ← State + API calls
  ui/
    product-card.tsx        ← Domain UI
    product-badge.tsx
  index.ts

// Stateful business module
entities/session/
  domain/
    session.types.ts        ← Session, TokenPair types
  model/
    session.store.ts
    token.ts                ← getToken, setToken, clearToken
  index.ts
```

### Entity UI — what's allowed

Entity `ui/` = **domain presentation** without business actions:

- ✅ Cards (`ProductCard`, `IssueCard`, `UserCard`)
- ✅ Badges, avatars, status indicators, previews
- ✅ Any read-only rendering of domain data

- ❌ Forms with business validation, interactive dialogs, action
  buttons with business logic — those are features
- ❌ Importing from other entity UIs; entity UI receives data via props

Wiring happens in higher layers.

```typescript
// ✅ entities/issue/ui/issue-card.tsx — pure, props-only
function IssueCard({ title, status, priority }: Props) { ... }

// ❌ reaching into another entity
import { currentUser } from '@/entities/session';
```

### When entity, when feature

| Situation | Where |
|---|---|
| Data used by **multiple features** | `entities/` |
| Data used by **one feature only** | `features/<name>/model/` |
| Data starts in one feature, another needs it → | move to `entities/` |
| Central domain concept, deliberate isolation | `entities/` (intentional) |
| Interactive form, dialog, action button with logic | `features/` |
| Pure domain rendering (card, badge, avatar) | `entities/<name>/ui/` |

---

## Shared Layer

Infrastructure, UI kit, and utilities with **zero business logic**. No
slices — organized by segments only.

**No barrel `index.ts`** — direct file imports only, for tree-shaking.

```text
shared/
  ui/                ← Button, Input, Modal, Card, Badge, Avatar
  lib/               ← cn(), formatDate(), debounce()
  api/               ← HTTP client, API helpers
  i18n/              ← Localization setup
  assets/            ← Images, fonts, icons
```

```typescript
// ✅ direct file imports
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

// ❌ barrel
import { Button, cn } from '@/shared';
```

**Belongs in shared:** UI primitives, utility functions, HTTP client,
i18n configuration, analytics setup, assets.

**Does not belong:** Business logic, session management
(→ `entities/session/`), domain types (→ `entities/`).

---

## Path Aliases

Configure `@/` alias for clean imports:

```typescript
// ✅
import { Button } from '@/shared/ui/button';
import { useUser } from '@/entities/user';

// ❌ relative imports across layers
import { Button } from '../../../shared/ui/button';
```

Configure in both bundler config and `tsconfig.json`.
