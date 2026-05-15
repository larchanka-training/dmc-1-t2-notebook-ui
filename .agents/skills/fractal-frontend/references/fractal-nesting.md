# Fractal Nesting

How to scale a slice's internal structure when it outgrows a flat
layout. Applies to any slice-based layer — features, entities, widgets.

---

## What can `modules/*` be?

**The team decides.** A module inside a feature can be:

- a **sub-feature** — a smaller cohesive block with its own domain,
  flow, and UI (e.g., `issue-list`, `issue-board`);
- a **use-case** — a single user action split out into its own folder
  (e.g., `create-issue`, `apply-coupon`);
- a **mix** — some modules are sub-features, others are use-cases.

Pick what makes the feature readable and maintainable. The granularity
inside a feature is a local organizational choice, not a global rule.

### What still doesn't change

- **Top-level `features/<name>/`** is always a cohesive product block
  (SKILL.md section 3), never a single use-case. Don't promote a
  use-case to a top-level feature.
- **Import rules** for `modules/`, `common/`, `model/`, `ui/` (below)
  are structural — they apply regardless of what each module
  represents semantically.

---

## When to Use

When a feature has **2+ distinct modules** that need shared code
between them. **Do not create in advance** — add when the feature
outgrows a flat structure and distinct parts worth separating emerge.

Features are the most common candidate. Entities may need it when a
domain concept has distinct sub-types with shared logic (e.g., voucher
with gift/discount variants). Widgets rarely need it.

---

## Structure: common/ + modules/

```text
features/issue-tracker/
  common/                      ← shared across sub-features
    domain/
      issue-filter.types.ts
    model/
      issue-filter.ts          ← filter state shared by list + board
      issue-selection.ts
  modules/                     ← sub-features, use-cases, or a mix
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
  model/                       ← feature-level facade, composes sub-features
    issue-tracker.facade.ts
  ui/                          ← feature-level composition UI
    issue-tracker-shell.tsx
  index.ts
```

Entity example:

```text
entities/voucher/
  common/
    domain/
      voucher.types.ts        ← shared types for all voucher kinds
    model/
      voucher.store.ts        ← shared state
  modules/
    gift-voucher/
      domain/
        gift-voucher.types.ts
      model/
        gift-voucher.ts
      index.ts
    discount-voucher/
      model/
        discount-voucher.ts
      index.ts
  index.ts
```

---

## common/ vs model/

| | `common/` | `model/` |
|---|---|---|
| **Who uses it** | `modules/`, `model/`, `ui/` | Only the parent slice itself |
| **Direction** | Shared down to sub-features | Composes up from sub-features |
| **Contains** | Types, stores, UI shared across sub-features | Slice-level facade, orchestration |

`common/` is the shared infrastructure of the slice — a contract between
sub-features. If something is needed by multiple `modules/*`, put it
in `common/`.

Can contain any segments: `domain/`, `model/`, `ui/`.

---

## Composition

The slice's `model/` imports from `modules/` to orchestrate their models
into a unified facade:

```typescript
// features/issue-tracker/model/issue-tracker.facade.ts
import { issueListModel } from '../modules/issue-list';
import { issueBoardModel } from '../modules/issue-board';
import { issueFilter } from '../common/model/issue-filter';

export function applyFilterEverywhere(filter: IssueFilter) {
  issueFilter.set(filter);
  issueListModel.refresh();
  issueBoardModel.refresh();
}
```

Sub-features don't know about each other or about parent `model/`.
Only the parent `model/` knows about all of them and wires them
together.

---

## Import Rules

```text
ui/        →  model/, domain/, common/               ✅
model/     →  domain/, common/, modules/             ✅  (composes)
domain/    →  nothing inside the slice                ✅
modules/*  →  ../common/                              ✅
modules/*  →  lower layers (entities/, shared/)       ✅
modules/*  →  ../modules/*                            ❌  siblings
modules/*  →  ../model/, ../ui/                       ❌  parent
common/    →  lower layers (entities/, shared/)        ✅
common/    →  model/, modules/, ui/                    ❌
```

**Key restrictions:**

1. `domain/` imports nothing inside the slice — it's the pure layer.
2. `common/` does not know about anything inside the slice — only lower
   layers.
3. `modules/*` cannot import sibling `modules/*` or parent's
   `model/`/`ui/`.
4. Only `model/` and `ui/` at the slice root can compose sub-features.

---

## Recursive Nesting

Sub-features follow the same structure recursively. If a sub-feature
itself grows complex, it can have its own `common/` + `modules/`:

```text
features/issue-tracker/
  modules/
    issue-board/
      common/          ← if board itself has its own sub-features
      modules/
        column/
        card/
      model/
      ui/
      index.ts
```

In practice, two levels of nesting are usually sufficient. If you need
three, consider whether the slice should be split into multiple
top-level features instead.
