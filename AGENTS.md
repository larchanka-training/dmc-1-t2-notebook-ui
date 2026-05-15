# AGENTS.md

Project-level guidance for AI coding agents (Claude Code, Cursor, Copilot, etc.) working in this UI codebase. This file is an **index of pointers**, not full content — read the linked docs on demand.

Human-facing documentation lives in `docs/`. This file only highlights conventions that agents are likely to violate if they default to generic React/JS habits.

---

## State management — Reatom

This project uses [Reatom](https://v1001.reatom.dev) (`@reatom/core` + `@reatom/react`) for state, async data, and orchestration. The base framework rules come from the upstream Reatom skill (`.claude/skills/reatom/SKILL.md`) — load that when the task involves atoms, computed, actions, effects, forms, or routing.

**Repo-specific note: `clearStack()` is enabled in `src/setup.ts`.** This makes Reatom's "explicit `wrap` at async boundaries" rule strict. The most common consequence: every React event handler that calls an atom or action must be wrapped (`onClick={wrap(() => action())}`), otherwise it throws `ReatomError: missing async stack` at runtime.

When working with React + Reatom — especially event handlers, callbacks passed as props, or anything that produces `missing async stack` errors — read **[docs/architecture/reatom.md](./docs/architecture/reatom.md)** before writing or reviewing JSX handlers.

---

## Architecture

Folder layout, routing, and path aliases are documented in `docs/architecture/`. Read those before adding new pages, features, or import structures.

- [docs/architecture/folder-structure.md](./docs/architecture/folder-structure.md)
- [docs/architecture/routing.md](./docs/architecture/routing.md)
- [docs/architecture/path-aliases.md](./docs/architecture/path-aliases.md)
- [docs/architecture/reatom.md](./docs/architecture/reatom.md)
- [docs/architecture/api-layer.md](./docs/architecture/api-layer.md)

The fractal frontend skill (`.claude/skills/fractal-frontend/`) governs layer placement and cross-feature boundaries — load it when deciding where new code should live.

---

## HTTP API

All HTTP traffic goes through the facade at `@/shared/api`. **Never import from `@/shared/api/generated/**`** in `features/`, `pages/`, or `app/` — ESLint (`no-restricted-imports`) will fail. Adding a new endpoint: update `openapi/<domain>.openapi.yaml`, run `pnpm api:generate`, then add a thin function to `src/shared/api/<domain>.ts`. See [docs/architecture/api-layer.md](./docs/architecture/api-layer.md) and the [`.agents/add-endpoint.md`](./.agents/add-endpoint.md) skill.

---

## Task-oriented skills

Reusable step-by-step procedures (add a page, add a shadcn component, etc.) live in [`.agents/`](./.agents/README.md). Prefer those over rediscovering the steps.

---

## Code style and contributing

See [docs/contributing.md](./docs/contributing.md) for code style rules, PR checklist, and the docs index.
