# Installation

## Prerequisites

| Tool    | Minimum version | Check           |
| ------- | --------------- | --------------- |
| Node.js | 20+ (LTS)       | `node -v`       |
| pnpm    | 9.15.9          | `pnpm -v`       |
| Git     | any             | `git --version` |

The CI pipeline and Docker images both use Node 20, and `package.json` pins pnpm to `9.15.9` via `packageManager`. Corepack (`corepack enable`) is the easiest way to match the pinned version automatically.

> **Why pnpm?** The project uses `pnpm-lock.yaml`. Using `npm install` will generate a conflicting `package-lock.json`. Always use `pnpm` in this repo.

If you don't have pnpm:

```bash
npm install -g pnpm
```

---

## Clone the repository

The UI is a standalone repository that is also vendored as a git submodule inside the monorepo `dmc-1-t2-notebook-mono`. Either clone is fine for local UI development:

```bash
# Standalone — UI only
git clone https://github.com/larchanka-training/dmc-1-t2-notebook-ui.git
cd dmc-1-t2-notebook-ui
```

```bash
# Monorepo — UI + API + infra. Use --recurse-submodules to pull the UI in.
git clone --recurse-submodules https://github.com/larchanka-training/dmc-1-t2-notebook-mono.git
cd dmc-1-t2-notebook-mono/ui
```

Work happens on feature branches off `main` — see [contributing.md](../contributing.md).

---

## Install dependencies

```bash
pnpm install
```

## Install Git hooks

Git hooks are optional local checks for developers. They are not installed automatically during `pnpm install`, so Docker builds and CI dependency installation do not depend on local Git metadata.

To enable local hooks:

```bash
pnpm run hooks:install
```

The hooks run formatting/linting before commit and heavier checks before push. GitHub Actions remain the required quality gate for pull requests.

---

## Verify the install

After installation you should see a `node_modules/` folder and no error output. Check that the key packages are present:

```bash
pnpm list react vite tailwindcss
```

Expected output (versions may vary):

```
react 19.x.x
vite 8.x.x
tailwindcss 4.x.x
```

---

## Next step

→ [Running the app](./running.md)
