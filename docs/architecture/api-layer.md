# API Layer

HTTP integration lives in `src/shared/api/` as a **facade** around a generated, typed OpenAPI client. Business code (in `features/`, `pages/`, `app/`) imports only from the facade — never reaches into the generated code.

---

## Where things live

```
src/shared/api/
├── generated/
│   └── openapi-ts/
│       ├── auth.d.ts          # types-only, regenerated from openapi/auth.openapi.yaml
│       ├── llm.d.ts           # types-only, regenerated from openapi/llm.openapi.yaml
│       └── notebook.d.ts      # types-only, regenerated from openapi/backend/openapi.json (sliced)
├── client.ts                  # openapi-fetch clients + auth-token middleware
├── errors.ts                  # ApiError + 400/401/404/429/5xx subclasses, status→error mapper
├── auth.ts                    # login / logout / getMe
├── llm.ts                     # generateCode (Cloud LLM agent)
├── notebook.ts                # list / create  (thin shim; full sync facade is #132)
└── index.ts                   # public re-export (namespace style)
```

Source-of-truth specs live in `openapi/`. `auth.openapi.yaml` and `llm.openapi.yaml` are hand-maintained. **notebook** types instead come from the backend contract: a vendored machine copy at `openapi/backend/openapi.json` (refreshed by `pnpm api:vendor`), from which `api-gen.mjs` slices the `/notebooks` paths. This keeps `ui` self-contained — generation never reads `../api`. See [`openapi/backend/README.md`](../../openapi/backend/README.md).

---

## Generator: `openapi-typescript` + `openapi-fetch`

- **`openapi-typescript`** (dev) emits a single `.d.ts` per domain. **Types only — no runtime.** auth/llm read their `openapi/*.openapi.yaml`; notebook is assembled on the fly from `openapi/backend/openapi.json` — paths under `/api/v1/notebooks` with the `/api/v1` prefix stripped (the client already targets that base) and the reachable schemas inlined.
  - The `/api/v1` version prefix is encoded in `scripts/notebook-slice.mjs` (`NOTEBOOK_PREFIX` / `STRIP_PREFIX`) and the client base URL (`client.ts`). An `/api/v2` bump touches both.
- **`openapi-fetch`** (prod) is a tiny typed fetch wrapper that takes the generated `paths` interface as a generic.

See `openapi.md` at the repo root for the PoC that compared this stack against `@hey-api/openapi-ts` and the rationale for choosing it.

---

## Public API of the facade

Consumers import the namespaces:

```ts
import { auth, llm, notebook } from '@/shared/api'

await auth.login({ email, password })
const notebooks = await notebook.list()
const created = await notebook.create({ title: 'Untitled' })
const generated = await llm.generateCode({ prompt: 'sum two numbers' })
```

Error classes (rethrown by every facade call when the HTTP status is non-2xx):

```ts
import { ApiError, UnauthorizedError, NotFoundError, BadRequestError } from '@/shared/api'

try {
  await notebook.list()
} catch (e) {
  if (e instanceof NotFoundError) {
    /* ... */
  }
  if (e instanceof UnauthorizedError) {
    /* ... */
  }
}
```

Token injection:

```ts
import { setAuthTokenGetter } from '@/shared/api'
import { tokenAtom } from '@/entities/session'

// Once at app boot (currently wired in src/app/model/setup.ts):
setAuthTokenGetter(() => tokenAtom())
```

The token itself lives in `@/entities/session` — the API facade only knows how to read it via the getter, so `shared/api` stays free of business state.

---

## Rules

1. **Never import from `@/shared/api/generated/**`** in `features/`, `pages/`, or `app/`. Enforced by ESLint (`no-restricted-imports`).
2. **`shared/api` is framework-agnostic** — no Reatom, no React. Functions return `Promise<T>` and throw `ApiError`. Reatom wrappers live in `features/<name>/model/`.
3. **The generated folder is committed** but is treated like a build artifact: never edit by hand, regenerate via `pnpm api:generate`. `api:check` in pre-push fails on drift.
4. **Calls from Reatom actions must use `wrap`** because the project enables `clearStack()`. See [reatom.md](./reatom.md):

   ```ts
   import { action, wrap } from '@reatom/core'
   import { notebook } from '@/shared/api'

   export const loadNotebooks = action(async () => {
     const items = await wrap(notebook.list())
     notebooksAtom.set(items)
   }, 'notebook.load')
   ```

---

## When to split by transport

Currently everything HTTP is flat in `shared/api/`. If a second transport appears (WebSocket / SSE — likely for streaming cell output), refactor in one PR:

```
shared/api/
├── rest/   # moves of auth.ts, notebook.ts, client.ts, generated/, errors.ts
└── ws/     # new
```

The public API at `@/shared/api` stays unchanged via `index.ts` re-exports, so `features/*` doesn't need to be touched.

---

## Scripts

- `pnpm api:generate` — regenerate all `*.d.ts` (auth/llm from their YAML; notebook from the vendored `openapi/backend/openapi.json` slice).
- `pnpm api:check` — generate into a temp dir and diff (EOL-insensitively) against the committed code. Fails if anything drifted. Runs in pre-push.
- `pnpm api:vendor` — refresh `openapi/backend/openapi.json` from `../api/docs/openapi.json`. Run deliberately when the backend contract changes; needs `../api`, and is **not** run by CI, `api:generate`, or `api:check`.

---

## Tests

Unit tests stub `globalThis.fetch` per-test with `vi.stubGlobal('fetch', vi.fn(...))` — see `src/shared/api/notebook.test.ts` for the pattern. Feature/model tests mock the api modules directly with `vi.spyOn(authApi, '…')` — see `src/features/auth/model/auth.test.ts`.
