---
name: fractal-frontend
description: >
  Fractal frontend architecture skill. Use when organizing project structure
  with layers, deciding where code belongs, defining public APIs and import
  boundaries, working with fractal nesting, resolving cross-feature
  communication, or deciding whether code should be promoted between layers.
---

# Fractal Frontend

> Fractal feature-first architecture. Inspired by Feature-Sliced
> Design (FSD), FEOD, and Evolution Design (ED). Rules define defaults; teams deviate with a reason.

---

## 1. Core Philosophy

- **Feature-first by default.** New business code lives in `features/`.
  Not in `pages/`, not in `entities/`, not in `shared/`.
- **Every layer can own logic appropriate to its scope** — except
  `shared/`, which stays pure infrastructure (no business logic, ever).
- **Cross-feature imports are always forbidden.** Features don't know
  about other features. They communicate through `entities/`,
  composition in pages/widgets, or events — see section 4.
- **Modules grow organically.** No fixed stages, no mandatory thresholds.
  A flat module stays flat if the work is flat; it segments or nests only
  when real complexity demands it.
- **Not all layers are required.** Most projects start with `app/`,
  `pages/`, `features/`, and `shared/`. Add `entities/` and `widgets/`
  on signal.

---

## 2. Layers & Import Rules

Six layers, strictly top-down imports:

```text
app/       → Application shell: providers, router, layouts, CSS theme
pages/     → Screens bound to routes. Compose + page-level orchestration
widgets/   → Compositions of features reused across multiple pages
features/  → Business features — isolated modules (not micro use-cases)
entities/  → Reusable business modules — domain data, services, domain UI
shared/    → Infrastructure, UI kit, utilities — zero business logic
```

### Import direction

```text
app/       →  pages, widgets, features, entities, shared
pages/     →  widgets, features, entities, shared
widgets/   →  features, entities, shared
features/  →  entities, shared
entities/  →  entities, shared
shared/    →  shared
```

Import only through `index.ts`. Never reach into module internals.

**Exception:** `shared/` has no barrel `index.ts` — import files directly
for tree-shaking.

### Cross-import restrictions (same-layer)

- **Features ✗ features** — always. Use section 4.
- **Widgets ✗ widgets** — always.
- **Entities ✓ entities** — allowed, prefer `import type`, avoid cycles.

### Routing

Lives in `app/` or framework convention (TanStack Router `routes/`,
Next.js `app/`, etc.). Route files are **thin** — import and render page
components.

---

## 3. What Makes One Feature

> **Important:** A *feature* is a cohesive product block — NOT a
> micro use-case (single user action).

### Coherence criterion (from ED)

> "All these things must have high semantic cohesion."

One feature = a block with **high semantic cohesion**. Three signs of
cohesion (prefer 3 out of 3):

1. **Shared domain** — one primary domain concept (Issue, Credentials,
   Comment).
2. **Shared user-flow** — actions inside converge on one primary flow
   (all auth actions → "logged in" state; all issue actions → "manage
   the issue").
3. **Single product name** — SPEC/PM/team calls it by one name ("the
   auth feature", "the issue tracker").

If only 1–2 match, lean toward splitting into two features.

### Diagnostic (from ED)

> "If you have many imports between features, the features are
> probably drawn incorrectly!"

When you find yourself wanting to cross-import often, the boundary is
wrong. Don't reach for an escape hatch — **redraw the boundary** or
extract the shared part to an `entity`.

### Size guidance

> "Don't make features small! It's normal to have 3–4 features in the
> early stages."

Features are **large blocks**, not individual use-cases. Typical
project: 3–10 features. Use-cases (create-X, edit-X, delete-X) live
**inside** a feature as files or sub-features, not as top-level folders.

**Examples of correct granularity:**

| ✅ One feature (with use-cases inside) | ❌ Each use-case as a feature |
|---|---|
| `features/auth/` (login, signup, recovery) | `features/login/` + `features/signup/` + `features/recovery/` |
| `features/issue-tracker/` (list, detail, board, filters, create) | `features/issue-list/` + `features/issue-create/` + … |
| `features/comments/` (post, edit, delete, mention) | `features/post-comment/` + `features/delete-comment/` + … |

### Modules inside a feature (fractal nesting)

When one feature grows enough to warrant internal structure, split its
parts into `modules/`. **What a module represents is a team call** —
a sub-feature (smaller cohesive block), a use-case (single user
action), or a mix. Granularity inside a feature is up to the team.

```text
features/issue-tracker/
  common/              ← shared across modules
    domain/
    model/
  modules/             ← sub-features, use-cases, or a mix — team decides
    issue-list/        ← sub-feature
    issue-board/       ← sub-feature
    create-issue/      ← use-case (if team prefers it as a folder)
  ui/                  ← feature-level composition
  model/               ← feature-level orchestration
  index.ts
```

The **top-level** `features/<name>/` still must be a cohesive block,
not a single use-case (section 3 coherence criterion). The freedom to
pick structure applies **inside** a feature, not at the top level.

See `references/fractal-nesting.md` for the import rules and
composition pattern.

---

## 4. Cross-Feature Communication

Feature A needs something from feature B. **Direct import is always
forbidden.** Pick one of four paths:

```text
1. Needs domain data or business logic?
   → Extract to entities/. Both features read from the entity.

2. Needs to render feature B's UI inside A's UI?
   → Compose at the parent layer (page or widget). Parent imports both.

3. Needs to trigger an action in B when A does something?
   → Event bus, or an action exposed by an entity. Contract is explicit.

4. Needs a utility with zero business logic?
   → Move to shared/lib/.
```

**Never:** `import { ... } from '@/features/B'` from inside `features/A`.

Details, code patterns, and edge cases: see
`references/cross-feature-communication.md`.

**Diagnostic:** If none of the four paths feels right, the feature
boundary is probably wrong. Redraw before coding around the rule.

---

## 5. Decision Framework — Where Does Code Live?

```text
New code → Is it:

┌─ Infrastructure with zero business logic (UI primitive, utility,
│  HTTP client, i18n, assets)?
│     → shared/  (see segments below)
│
├─ A reusable business module (domain data, service, domain UI)
│  that is:
│    (a) used by 2+ features, OR
│    (b) intentionally extracted by the team?
│     → entities/<name>/
│
├─ A composition of features reused across 2+ pages?
│     → widgets/<name>/
│
├─ Page-specific orchestration, layout, route-level state, or
│  pure presentational UI used only on one page?
│     → pages/<slice>/
│
└─ Everything else (new feature business code)?
     → features/<name>/     ← the default home
```

### Where pages fit

Pages compose features and widgets, and may own:

- Route-level orchestration between features (page facade, loader glue).
- Page-level state that doesn't belong to any single feature.
- Pure presentational UI used only on this page (hero block, decorative
  sections, one-off layout fragments).

Pages **do not** own: business rules of their own, reusable forms,
shared data fetching. Those belong in features or entities.

### Where entities fit (two triggers)

1. **Pragmatic:** code is actually used by 2+ features.
2. **Intentional:** team deliberately isolates the domain concept.

> Caveat for the intentional trigger: it's cheap to overuse. "I want
> it cleaner" alone is not enough. Prefer the pragmatic trigger when
> in doubt; extract intentionally only when the domain concept is
> clearly first-class in the product.

### Module growth — when to restructure

No fixed stages, no mandatory sizes. Three signals (from FEOD) say
**"pause and consider restructuring"**:

1. The module has grown too large to hold in your head.
2. Responsibility inside the module needs to be split between people.
3. Part of the module now deserves its own documentation.

Useful review indicators (non-mandatory):

- More than ~6–8 files at one level.
- Single file over ~400 lines.
- You can't quickly point to where a concern lives.
- Two distinct concerns are tangled (data + UI + API in one file).

A valid response is "not yet" — but only after you paused and asked.

---

## 6. Quick Placement Table

| Scenario | Single use | Reused (by 2+ features) |
|---|---|---|
| Login/signup forms | `features/auth/` (one feature, sub-features inside) | same |
| User profile form | `features/profile/` | `features/profile/` + `entities/user/` (data) |
| Product card (display only) | `features/<name>/ui/ProductCard.tsx` | `entities/product/ui/ProductCard.tsx` |
| Product data fetching, types | `entities/product/` | `entities/product/` |
| Add-to-cart interaction | `features/cart/` | `features/cart/` |
| Session / tokens / current user | `entities/session/` (always) | `entities/session/` |
| HTTP client | `shared/api/` (always) | `shared/api/` |
| Generic Card/Button/Input | `shared/ui/` | `shared/ui/` |
| Date formatting util | `shared/lib/` | `shared/lib/` |
| Sidebar navigation | `app/layouts/` | `widgets/sidebar/` |
| Landing-page hero (no logic) | `pages/landing/ui/Hero.tsx` | — |
| Page-level data orchestration across features | `pages/<slice>/model/` | — |

---

## 7. Architectural Rules (MUST)

Violations weaken the architecture. If you must break a rule, document
the reason and get team agreement.

### 7-1. Import direction

`app → pages → widgets → features → entities → shared`. Upward imports
are forbidden.

### 7-2. No cross-imports between features or widgets

`features/A` never imports from `features/B`. Widgets never import
other widgets. If they need to interact, use section 4.

### 7-3. Public API — every module exports through `index.ts`

```typescript
// ✅
import { LoginForm } from "@/features/auth";

// ❌ bypasses public API
import { LoginForm } from "@/features/auth/modules/login/ui/LoginForm";
```

**Exception:** `shared/` has no barrel — direct file imports only.

### 7-4. No business logic in `shared/`

`shared/` = UI kit + infrastructure + utilities. Business logic,
domain rules, and workflows belong in `entities/` or `features/`.

### 7-5. Domain-based file naming

```text
// ❌
model/types.ts          ← Which types?
model/utils.ts

// ✅
model/user.ts           ← User types + user logic
model/issue.ts
```

### 7-6. Segment dependency is unidirectional

```text
domain → model → ui
```

Never import backwards. See section 10 for segments.

### 7-7. Top-level features are not single use-cases

`features/<name>/` at the top level is a cohesive product block
(section 3), never a single user action. `features/create-issue/` is
wrong — that logic belongs inside `features/issue-tracker/`. Inside a
feature, teams are free to organize `modules/` however fits (section
3).

---

## 8. Anti-patterns (AVOID)

- **Creating a feature per use-case.** `features/create-issue/` is
  wrong; it's a file inside `features/issue-tracker/`.
- **Cross-importing between features.** Use section 4 paths. If none
  fit, your feature boundary is wrong.
- **Putting business logic in `shared/`.** Infrastructure only.
- **Creating an entity "because it feels cleaner"** without the
  pragmatic trigger or a clear intentional reason.
- **Splitting one cohesive feature into many small ones.** If the
  domain and flow are shared, it's one feature with sub-features.
- **Merging truly independent features into one** to bypass the
  no-cross-import rule. Use entities or composition instead.
- **Technical-role file names** (`types.ts`, `utils.ts`). Use the
  domain name.
- **Empty layer directories "just in case."** Add a layer when it
  earns its place.
- **Skipping the public API.** `index.ts` is the only entrance.

---

## 9. Entity UI — What's Allowed

Entity `ui/` is for **domain presentation** — components that render
domain data without owning business actions:

- ✅ Cards (ProductCard, IssueCard, UserCard)
- ✅ Avatars, badges, status indicators, previews
- ✅ Read-only domain rendering

- ❌ Interactive forms, dialogs, action buttons with business logic
  (those are features)
- ❌ Importing from other entities (entity UI is pure — receives data
  via props)

Wiring (fetching data, triggering actions, combining entities) happens
in higher layers: features, widgets, pages.

---

## 10. Segments

Each module (in `features/`, `entities/`, and sub-feature `common/`)
is organized into 3 segments with unidirectional dependency:

```text
domain → model → ui
```

| Segment   | Purpose                                     | Depends on |
|-----------|---------------------------------------------|------------|
| `domain/` | Types, mappers, pure operations             | nothing    |
| `model/`  | State, stores, actions, computed, API calls | `domain/`  |
| `ui/`     | Components                                  | all above  |

**Segments are a default, not a mandate.** Add `api/`, `lib/`,
`service/` if they earn their place. The only hard rule is
**unidirectional dependency**.

Not all segments are required. A simple feature often ships with just
`model/` + `ui/`.

---

## 11. Quick Reference

- **Default home for new code**: `features/`
- **Import direction**: `app → pages → widgets → features → entities → shared`
- **Minimal project**: `app/` + `pages/` + `features/` + `shared/`
- **Create entities when**: used by 2+ features, or intentional extraction
- **Create widgets when**: composition reused across 2+ pages
- **Cross-feature imports**: always forbidden (section 4)
- **Feature vs use-case**: feature = cohesive product block; use-case = file inside
- **Modules inside a feature**: sub-features, use-cases, or a mix — team decides
- **Segments**: `domain → model → ui` (unidirectional)
- **Public API**: through `index.ts` (except `shared/` — direct files)
- **Cross-layer siblings**: features ✗ features, widgets ✗ widgets, entities ✓ entities
- **File naming**: domain-based (`user.ts`, not `types.ts`)
- **Module growth**: organic; pause and consider when size/complexity signals hit
- **Entities vs shared**: entities = reusable business; shared = infrastructure

---

## 12. Conditional References

Read a reference **only** when its situation applies. Do not preload.

- **Creating, reviewing, or reorganizing layers and module folders**
  → `references/layer-structure.md`

- **Creating or restructuring a feature**, feature anatomy, segments
  → `references/feature-anatomy.md`

- **A feature outgrows a flat structure** and needs sub-features
  (`common/` + `modules/`) — applies to features, entities, widgets
  → `references/fractal-nesting.md`

- **Resolving cross-feature interaction** or entity cross-imports
  → `references/cross-feature-communication.md`

- **Applying concrete patterns** — authentication, CRUD entity,
  complex feature composition, widget assembly, type placement
  → `references/practical-examples.md`
