# Cross-Feature Communication

How features interact **without direct imports**. Features never import
other features — this is a core rule. This reference covers the
strategies for resolving situations where features need to share data
or trigger each other's actions.

---

## The Problem

Features are isolated modules. A direct import creates coupling and
violates the architecture:

```typescript
// ❌ features/cart imports features/promo — forbidden
import { applyPromoCode } from '@/features/promo';
```

### Diagnostic (ED)

> "If you have many imports between features, the features are
> probably drawn incorrectly!"

If you find yourself reaching for cross-imports often, the boundary
between your features is probably wrong. Before adopting one of the
strategies below, pause and ask: "Are these actually two features, or
one with sub-features?"

---

## Strategy 1: Shared Entity

When two features need the same **data** or **domain logic**, extract
it to `entities/`. Both features read from the entity.

```text
// Before: two features duplicate order types
features/order-create/
  model/order.ts        ← Order types (duplicated)
features/order-history/
  model/order.ts        ← Order types (duplicated)

// After: shared domain in entities
entities/order/
  domain/
    order.types.ts      ← shared types
  model/
    order.store.ts      ← shared state
  index.ts

features/order-create/  ← imports from entities/order
features/order-history/ ← imports from entities/order
```

**When to use:** Two features operate on the same business data. The
shared part is domain logic (types, validation, business calculations)
or shared state.

**Key:** Extract only the genuinely shared domain logic.
Feature-specific UI, state, and flows stay in the feature.

---

## Strategy 2: Compose in Page or Widget

Use the layer above (page or widget) to wire features together through
**props, render props, callbacks, or dependency injection**. The
features never reference each other.

### Props and Callbacks

```typescript
// pages/cart/ui/cart-page.tsx
import { Cart } from '@/features/cart';
import { PromoCodeInput } from '@/features/promo';
import { usePromoActions } from '@/features/promo';

export function CartPage() {
  const { applyPromo } = usePromoActions();

  return (
    <>
      <Cart onApplyPromo={applyPromo} />
      <PromoCodeInput />
    </>
  );
}
```

### Render Props / Slots

```typescript
// widgets/product-catalog/ui/product-catalog.tsx
import { ProductList } from '@/features/catalog';
import { AddToCartButton } from '@/features/cart';

export function ProductCatalog() {
  return (
    <ProductList
      renderActions={(product) => <AddToCartButton product={product} />}
    />
  );
}
```

### Dependency Injection

```typescript
// features/notifications/model/notifications.ts
interface NotificationDeps {
  getUserName: (userId: string) => string;
}

export const createNotificationService = (deps: NotificationDeps) => ({
  format: (n) => `${deps.getUserName(n.userId)}: ${n.message}`,
});

// pages/dashboard/model/setup.ts — wire dependencies
import { createNotificationService } from '@/features/notifications';
import { getUserName } from '@/entities/user';

export const notificationService = createNotificationService({ getUserName });
```

**When to use:** Features are genuinely independent concepts and the
connection between them is a composition concern.

---

## Strategy 3: Event Bus or Entity Action

When feature A must trigger something in feature B, expose the contract
through a shared channel — an event bus or an action on an entity.

### Via an entity action

```typescript
// entities/notifications/model/notifications.ts
export const notificationsStore = {
  push(message: string) { /* ... */ },
};

// features/order-create/model/order.ts
import { notificationsStore } from '@/entities/notifications';
notificationsStore.push('Order created');

// features/notifications-panel reads from the same store
```

### Via an event bus

```typescript
// shared/lib/event-bus.ts — pure infrastructure, no domain
export const bus = createEventBus<AppEvents>();

// features/order-create emits
bus.emit('order:created', { id });

// features/analytics subscribes — no dependency between features
bus.on('order:created', track);
```

**When to use:** The interaction is a contract that naturally belongs
to the domain (entity action) or a cross-cutting signal (event bus).

---

## Strategy 4: Move Pure Utility to Shared

If the code you'd cross-import is a **pure utility** with zero business
logic (a date formatter, a string helper, a generic hook), move it to
`shared/lib/` — both features import from there.

**Not for:** anything with domain meaning. Business logic never goes to
`shared/`.

---

## If None of the Strategies Fit — Reconsider Your Boundaries

Two features that constantly need each other are often **sub-features
of one larger feature**. Instead of fighting the isolation rule, merge
them with `modules/`:

```text
// Before: two features that always change together
features/issue-list/
  model/issues.ts
  ui/issue-table.tsx
features/issue-filters/
  model/filters.ts
  ui/filter-bar.tsx

// After: one feature (issue-tracker) with sub-features
features/issue-tracker/
  common/
    domain/
      issue-filter.types.ts
  modules/
    issue-list/
      model/issues.ts
      ui/issue-table.tsx
      index.ts
    issue-filters/
      model/filters.ts
      ui/filter-bar.tsx
      index.ts
  model/
    issue-tracker.facade.ts
  ui/
    issue-tracker-shell.tsx
  index.ts
```

**Signs your features should be one feature with sub-features:**

- They always change together.
- They share most dependencies.
- Separating them leads to excessive prop drilling or event passing.
- They represent sub-blocks of **one** user-facing capability (same
  domain, same flow, same name).

**When NOT to merge:**

- They have different domains, flows, or product names.
- They have different release lifecycles or ownership.
- They rarely interact.

---

## Decision Flowchart

```text
Feature A needs something from feature B
  │
  ├─ Do they share business data or domain logic?
  │     → Strategy 1: extract to entities/
  │
  ├─ Is the connection a UI composition concern?
  │     → Strategy 2: compose in page or widget
  │
  ├─ Is it a cross-cutting signal or domain action?
  │     → Strategy 3: event bus or entity action
  │
  ├─ Is the shared bit a pure utility with no business logic?
  │     → Strategy 4: move to shared/lib/
  │
  └─ None of the above?
      → The boundary is wrong. Redraw features — likely two
        sub-features of one feature (use modules/).
```

---

## Entity Cross-Imports

Unlike features, **entities CAN import other entities**. Domain
concepts naturally reference each other (an Order references a User, a
Comment references an Issue).

**Rules:**

1. **Prefer `import type`** to minimize runtime coupling:
   ```typescript
   // entities/order/domain/order.types.ts
   import type { User } from '@/entities/user';

   export interface Order {
     id: string;
     customer: User;
   }
   ```

2. **Avoid cycles.** If entity A imports entity B and B imports A,
   consider merging them or extracting the shared part.

3. **Entity UI must not import other entity UIs.** Wiring entity UI
   components happens in upper layers (features, widgets, pages) via
   props.

4. **Aggregates own related data.** An `order` entity that imports
   `product` and `user` types is fine — it's an aggregate.
