# Installation

## Prerequisites

| Tool | Minimum version | Check |
|---|---|---|
| Node.js | 18+ | `node -v` |
| pnpm | 8+ | `pnpm -v` |
| Git | any | `git --version` |

> **Why pnpm?** The project uses `pnpm-lock.yaml`. Using `npm install` will generate a conflicting `package-lock.json`. Always use `pnpm` in this repo.

If you don't have pnpm:

```bash
npm install -g pnpm
```

---

## Clone the repository

```bash
git clone https://github.com/larchanka-training/dmc-1-t2-notebook-ui.git
cd dmc-1-t2-notebook-ui
```

Then switch to the working branch:

```bash
git checkout feature/init-ui-components
```

---

## Install dependencies

```bash
pnpm install
```

### Known issue: msw build scripts

On first install you may see:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: msw@2.14.6
```

This is a pnpm security feature blocking `msw` (a transitive dependency) from running install scripts. It is already handled in `package.json`:

```json
"pnpm": {
  "onlyBuiltDependencies": ["msw"]
}
```

If the error still appears, run:

```bash
pnpm install --ignore-scripts
```

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
