# Project Overview

## What is JS Notebook?

JS Notebook is a browser-based interactive coding environment built as a training project for **group TARDIS T2**. It is conceptually similar to [Jupyter Notebook](https://jupyter.org/) — but instead of Python, it runs **JavaScript** natively in the browser.

There is no backend, no server, and no install required beyond the project itself. Open the app, write JavaScript in a cell, press **Cmd+Enter**, and see the output immediately below.

---

## Why JS Notebook?

Jupyter Notebook made interactive Python computing accessible to everyone. The same idea applied to JavaScript means:

- **No runtime to install** — every browser already has a JS engine
- **Async-native** — JavaScript's `async/await` works out of the box in cells
- **Instant feedback** — no kernel to start, no kernel to restart
- **Frontend-native** — the tool and the language it runs share the same environment

---

## Group & Course Info

| Field | Value |
|---|---|
| **Group** | TARDIS T2 |
| **Project** | JS Notebook |
| **Type** | Training course project |
| **Year** | 2026 |
| **Stack** | React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Reatom |

---

## Pages at a Glance

| Route | Description |
|---|---|
| `/` | The notebook — write and run JavaScript cells |
| `/components/shadcn` | Live gallery of all installed shadcn/ui components |
| `/components/custom` | Custom components built for this project |
| `/login` | Login page UI example |
| `/about` | Project and course information |

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 19 | Industry standard, hooks-first |
| Language | TypeScript | Type safety across the whole project |
| Build tool | Vite 8 | Instant HMR, fast cold starts |
| Styling | Tailwind CSS v4 | Utility-first, zero config with Vite plugin |
| Components | shadcn/ui (base-ui renderer) | Copy-owned primitives |
| State & routing | Reatom (`@reatom/core` + `@reatom/react`) | One model for atoms, async data, routing, forms |
| Testing | Vitest + Testing Library | Fast, ESM-native, jsdom-based |
| Package manager | pnpm | Faster installs, disk-efficient |

---

## Related Docs

- [Installation](./installation.md)
- [Running the app](./running.md)
- [Architecture](../architecture/folder-structure.md)
