# Practical Examples

Concrete patterns for common scenarios. Examples are framework and
library agnostic — focus on structure and placement, not specific
tools.

---

## Authentication Pattern

Auth spans two layers: a feature for the UI and flow, an entity for
the session/tokens.

### Tokens and session → `entities/session/`

Session is a reusable business module — user context consumed across
the app (auth interceptors, protected routes, user avatars,
permission checks):

```text
entities/session/
  domain/
    session.types.ts          ← Session, TokenPair
  model/
    session.store.ts          ← current session state
    token.ts                  ← getToken, setToken, clearToken
  index.ts
```

```typescript
// entities/session/domain/session.types.ts
export interface Session {
  userId: string;
  email: string;
  role: 'admin' | 'member';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
```

### Auth UI and flow → `features/auth/`

Login, signup, and password recovery share a domain (Credentials), a
flow (authenticate / become logged in), and a product name (auth) —
one feature with sub-features:

```text
features/auth/
  common/
    model/
      auth-api.ts             ← shared API client for auth endpoints
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
```

### User profile data → `entities/user/`

Create `entities/user/` only when user profile is needed in 2+
features (avatars in comments, names in issue assignees), not just
for auth.

```text
entities/user/
  domain/
    user.types.ts             ← profile: displayName, avatar, role
    user.mapper.ts            ← DTO → domain
  model/
    user.store.ts             ← state + API calls
  ui/
    user-avatar.tsx           ← domain UI
  index.ts
```

### Summary

| What | Where | Why |
|---|---|---|
| Tokens, refresh, session state | `entities/session/` | reusable business module |
| Login / signup / recovery UI + flow | `features/auth/` with sub-features | one cohesive feature |
| User profile data | `entities/user/` | domain model, reused across features |

---

## CRUD Entity

A typical entity with all segments:

```text
entities/product/
  domain/
    product.types.ts          ← domain type + constants
    product.mapper.ts         ← DTO → domain mapping
  model/
    product.store.ts          ← state + API calls
  ui/
    product-card.tsx          ← domain display component
    product-badge.tsx
  index.ts
```

### domain/ — pure types and mappers

```typescript
// entities/product/domain/product.types.ts
export interface Product {
  id: string;
  name: string;
  price: number;
  formattedPrice: string;
  isOnSale: boolean;
}

// entities/product/domain/product.mapper.ts
import type { ProductDTO } from '@/shared/api/product';
import type { Product } from './product.types';

export const toProduct = (dto: ProductDTO): Product => ({
  id: dto.id,
  name: dto.name,
  price: dto.price,
  formattedPrice: `$${dto.price.toFixed(2)}`,
  isOnSale: dto.price < 10,
});
```

### model/ — state + API calls

```typescript
// entities/product/model/product.store.ts
import { httpClient } from '@/shared/api/client';
import { toProduct } from '../domain/product.mapper';

export const productApi = {
  getById: async (id: string) => {
    const dto = await httpClient.get(`/products/${id}`);
    return toProduct(dto);
  },
  getAll: async () => {
    const dtos = await httpClient.get('/products');
    return dtos.map(toProduct);
  },
};
```

### ui/ — domain display (props-only)

```typescript
// entities/product/ui/product-card.tsx
// Receives data through props — no dependencies on other entities

interface ProductCardProps {
  name: string;
  formattedPrice: string;
  isOnSale: boolean;
}

export function ProductCard({ name, formattedPrice, isOnSale }: ProductCardProps) {
  return (
    <div>
      <h3>{name}</h3>
      <span>{formattedPrice}</span>
      {isOnSale && <span>Sale!</span>}
    </div>
  );
}
```

### index.ts — public API

```typescript
// entities/product/index.ts
export type { Product } from './domain/product.types';
export { toProduct } from './domain/product.mapper';
export { productApi } from './model/product.store';
export { ProductCard } from './ui/product-card';
export { ProductBadge } from './ui/product-badge';
```

---

## Complex Feature with Sub-Features

An `issue-tracker` feature with list, board, and detail sub-features:

```text
features/issue-tracker/
  common/
    domain/
      issue-filter.types.ts
    model/
      issue-filter.ts         ← shared filter state
      issue-selection.ts      ← shared multi-select
  modules/
    issue-list/
      model/
        issue-list.ts
      ui/
        issue-list.tsx
        issue-row.tsx
      index.ts
    issue-board/
      model/
        issue-board.ts
        drag-drop.ts
      ui/
        issue-board.tsx
        board-column.tsx
      index.ts
    issue-detail/
      model/
        issue-detail.ts
      ui/
        issue-detail.tsx
      index.ts
  model/
    issue-tracker.facade.ts   ← orchestrates sub-features
  ui/
    issue-tracker-shell.tsx   ← composes sub-feature UIs
  index.ts
```

### Orchestration in model/

```typescript
// features/issue-tracker/model/issue-tracker.facade.ts
import { issueListModel } from '../modules/issue-list';
import { issueBoardModel } from '../modules/issue-board';
import { issueFilter } from '../common/model/issue-filter';

export const issueTrackerFacade = {
  applyFilter(filter: IssueFilter) {
    issueFilter.set(filter);
    issueListModel.refresh();
    issueBoardModel.refresh();
  },
};
```

### Composition in ui/

```typescript
// features/issue-tracker/ui/issue-tracker-shell.tsx
import { IssueList } from '../modules/issue-list';
import { IssueBoard } from '../modules/issue-board';
import { View } from '../common/model/view';

export function IssueTrackerShell() {
  const view = View.use();
  return view === 'list' ? <IssueList /> : <IssueBoard />;
}
```

---

## Feature Growth

How a feature grows with complexity — organically, without fixed
stages or thresholds. A flat feature is valid; a complex one nests.

### Stage A: Simple feature, flat

```text
features/favorites/
  model/
    favorites.ts              ← state + API + use-cases as functions
  ui/
    toggle-favorite.tsx
  index.ts
```

### Stage B: Feature with domain segment

Types grow enough to deserve a separate file:

```text
features/cart/
  domain/
    cart.types.ts
  model/
    cart.ts                   ← state + API + use-cases
  ui/
    cart-button.tsx
    cart-drawer.tsx
  index.ts
```

### Stage C: Feature with sub-features

Two+ distinct cohesive UI-blocks emerge and need shared code. **At any
of these signals**, pause and consider restructuring:

- The feature has grown too large to hold in your head.
- Responsibility inside the feature needs to be split between people.
- Part of the feature now deserves its own documentation.

```text
features/issue-tracker/
  common/
    domain/
    model/
  modules/
    issue-list/
    issue-board/
  ui/
  model/
  index.ts
```

A valid answer at any signal is "not yet" — but only after you paused
and asked.

---

## Page Composes, Doesn't Own Business Logic

Pages always stay thin. They compose features and widgets, and may own
page-level orchestration or page-only presentational UI.

```typescript
// pages/products/ui/product-list-page.tsx
import { ProductCatalog } from '@/widgets/product-catalog';
import { Header } from '@/widgets/header';

export function ProductListPage() {
  return (
    <>
      <Header />
      <ProductCatalog />
    </>
  );
}
```

If a page grows a lot of its own logic, that's a signal the logic
actually belongs to a feature (business logic) or a widget
(composition) — extract it.

---

## Widget Composition

A header widget composes features from different domains:

```text
widgets/header/
  ui/
    header.tsx
    navigation.tsx
    user-menu.tsx
  model/
    header.ts
  index.ts
```

```typescript
// widgets/header/ui/header.tsx
import { WorkspaceSwitcher } from '@/features/workspace';
import { UserAvatar } from '@/entities/user';
import { Navigation } from './navigation';

export function Header() {
  return (
    <header>
      <WorkspaceSwitcher />
      <Navigation />
      <UserAvatar />
    </header>
  );
}
```

**This widget exists because** the same header appears on every
authenticated page. If it were only on one page, it would stay in that
page's local UI.

---

## Type Placement Guide

| Type scope | Location |
|---|---|
| API response/request shapes (DTOs) | `shared/api/` or contracts package |
| Domain model for a reused entity | `entities/*/domain/` |
| Types used only in one feature | `features/*/domain/` or `features/*/model/` |
| Types used only in one page | `pages/*/ui/` local types |
| Generic utility types (`Nullable<T>`) | `shared/lib/types.ts` |
| Infrastructure types (HTTP config) | `shared/api/` |

**Rule:** Raw API shapes (DTOs) stay close to transport. Domain models
with business meaning go in entities or features. If you only need the
raw shape and have no business logic, a shared types file is enough.

---

## entities/ vs shared/ — When to Use Each

| Question | Answer | Layer |
|---|---|---|
| Does it have **zero** logic and **zero** state? | UI primitive or utility | `shared/` |
| Is it **infrastructure** with no business context? | HTTP client, i18n, analytics | `shared/` |
| Is it a **reusable business module**? | Domain model, session, workspace | `entities/` |
| Is it a **user-facing feature**? | Feature with UI + state + flow | `features/` |

```text
shared/ui/button.tsx              ← zero logic, zero state
shared/lib/cn.ts                  ← pure utility
shared/api/client.ts              ← infrastructure (HTTP client)
entities/session/model/token.ts   ← business module (session state)
entities/user/domain/user.ts      ← business module (user profile)
entities/product/ui/product-card.tsx ← domain UI (pure display)
features/auth/model/login.ts      ← feature (login flow)
```
