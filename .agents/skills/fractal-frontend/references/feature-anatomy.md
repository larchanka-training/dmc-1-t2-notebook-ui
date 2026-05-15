# Feature Anatomy

Internal structure of a feature.

---

## What Is a Feature

A feature is a cohesive product block with its own state, business
logic, and UI. It is NOT a micro use-case (a single user action).

Think of a feature as a mini-application inside your project — an
isolated unit with its own bounded context that encapsulates the
business logic and UI of one product capability.

### Coherence criterion

One feature has **high semantic cohesion**. Three signs (aim for 3 of 3):

1. **Shared domain** — one primary domain concept (Issue, Credentials,
   Comment).
2. **Shared user-flow** — actions inside converge on one flow (all auth
   actions → "logged in"; all issue actions → "manage the issue").
3. **Single product name** — SPEC/PM/team call it by one name.

If only 1–2 match, split into multiple features.

### Diagnostic

If you find yourself needing to cross-import between two features,
the boundary is probably wrong. Redraw boundaries or extract shared
domain to an `entity` — don't reach for workarounds.

### Granularity

Features are **large blocks** (3–10 per project on first iterations).
They are not individual use-cases. Use-cases live inside a feature as
files or sub-features.

**Examples of correct granularity:**

| ✅ One feature | ❌ Use-case per feature |
|---|---|
| `features/auth/` | `features/login/` + `features/signup/` |
| `features/issue-tracker/` | `features/issue-create/` + `features/issue-filter/` |
| `features/comments/` | `features/post-comment/` + `features/delete-comment/` |

---

## Segments

A feature is organized into 3 segments with unidirectional dependency:

```text
domain → model → ui
```

| Segment   | Purpose                                     | Depends on |
|-----------|---------------------------------------------|------------|
| `domain/` | Types, mappers, pure operations             | nothing    |
| `model/`  | State, stores, actions, computed, API calls | `domain/`  |
| `ui/`     | Components                                  | all above  |

**Segments are a default, not a mandate.** `domain/model/ui` is the
standard set. Remove segments you don't need or add custom ones
(`api/`, `service/`, `lib/`) when the feature demands it. The only
hard rule: **unidirectional dependency**.

Start with what you need — typically `model/` + `ui/` is enough for a
simple feature.

```text
features/favorites/
  model/
    favorites.ts         ← state + API + business logic
  ui/
    toggle-favorite.tsx
  index.ts
```

---

## Simple Feature

No sub-features needed. Flat structure:

```text
features/favorites/
  model/
    favorites.ts
  ui/
    toggle-favorite.tsx
  index.ts
```

Or with domain types extracted:

```text
features/cart/
  domain/
    cart.types.ts
  model/
    cart.ts                ← state + API calls + use-cases (add, remove, clear)
  ui/
    cart-button.tsx
    cart-drawer.tsx
  index.ts
```

Use-cases (add-to-cart, remove-from-cart, clear-cart) live as functions
/ actions inside `model/cart.ts` or as separate files in `model/`.
**Never** as folders.

---

## Complex Feature (Fractal Nesting)

When a feature grows enough to warrant internal structure, introduce
`common/` and `modules/`.

> Modules inside a feature can be sub-features (smaller cohesive
> blocks), use-cases (single user actions), or a mix — the team
> decides what organization fits. The top-level feature itself must
> still be a cohesive product block (see SKILL.md section 3).

For the full pattern, import rules, and examples, see
`references/fractal-nesting.md`.

---

## Checklist: Creating a New Feature

1. **Confirm it's really a new feature.** Is the domain, flow, or
   product name already owned by an existing feature? If so, add a
   file or sub-feature there — don't create a new top-level feature.

2. **Confirm it's not a use-case.** Use-cases are files inside a
   feature, not folders in `features/`.

3. **Confirm it's a feature, not an entity.** Reusable business module
   (domain data, service, domain UI) used by 2+ consumers →
   `entities/`. Interactive feature with its own state → `features/`.

4. **Create the directory:**
   ```text
   src/features/<name>/
   ```

5. **Start with only the segments you need.** Typically `model/` + `ui/`:
   ```text
   features/<name>/
     model/
       <name>.ts
     ui/
       <Component>.tsx
     index.ts
   ```

6. **Create `index.ts`** re-exporting the public API:
   ```typescript
   export { MyComponent } from './ui/my-component';
   export { myModel } from './model/my-model';
   ```

7. **Verify imports.** The feature should only import from `entities/`
   and `shared/`. No imports from other features, widgets, pages, or
   app.

8. **Do NOT add `common/` or `modules/` upfront.** Add when 2+ distinct
   sub-features emerge and need shared code between them.

9. **Add `domain/` when** types or mappers grow enough to deserve a
   separate file.
