# Vendored backend OpenAPI contract — DO NOT EDIT BY HAND

`openapi.json` in this folder is a machine copy of `api/docs/openapi.json` (the
backend's source-of-truth OpenAPI schema), produced by `pnpm api:vendor`.

## Why this exists

`ui` must build on its own. Its CI and pre-push hooks check out only `ui` — there
is no `../api` available — so type generation reads this vendored copy rather than
the live backend schema.

## How it is used

- `pnpm api:generate` slices the notebook paths out of this copy, strips the
  `/api/v1` prefix, and writes `src/shared/api/generated/openapi-ts/notebook.d.ts`.
- `pnpm api:check` regenerates from this copy and fails if the committed
  `notebook.d.ts` is stale.
- `pnpm api:vendor` refreshes this copy from `../api/docs/openapi.json`. It is
  **not** run by CI, `api:generate`, or `api:check`.

Do not edit `openapi.json` here by hand — re-run `pnpm api:vendor`. See
`docs/architecture/api-layer.md` for the full flow.
