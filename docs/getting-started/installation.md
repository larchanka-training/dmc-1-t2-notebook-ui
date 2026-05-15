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
