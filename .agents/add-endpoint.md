# Skill: add-endpoint

Add a new HTTP endpoint to the API facade. Three steps every time: update the OpenAPI spec, regenerate types, add a thin function to the facade.

## Usage

Invoke this skill with:

- domain (`auth`, `notebook`, …) — must match an existing `openapi/<domain>.openapi.yaml`. For a new domain, create that file first.
- HTTP method + path (e.g. `POST /notebooks/{id}/share`)
- operationId (camelCase, e.g. `shareNotebook`)
- request/response shapes (or names of existing schemas to reuse)

## Steps

### 1. Update the OpenAPI spec

Edit `openapi/{domain}.openapi.yaml`:

- Add the path + method under `paths:` with `operationId`, `tags`, params, `requestBody`, `responses` (`200` / `201` / `204` + relevant error codes via `$ref: '#/components/responses/...'`).
- Add any new schemas under `components.schemas`.
- Validate: `npx @redocly/cli lint openapi/{domain}.openapi.yaml` — must be 0 errors.

### 2. Regenerate the typed client

```bash
pnpm api:generate
```

This rewrites `src/shared/api/generated/openapi-ts/{domain}.d.ts`. Don't edit the generated file.

### 3. Add a thin function to the facade

Edit `src/shared/api/{domain}.ts`. Pattern:

```ts
export async function shareNotebook(id: string, body: ShareRequest): Promise<ShareResponse> {
  const { data, error, response } = await notebookClient.POST('/notebooks/{id}/share', {
    params: { path: { id } },
    body,
  })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}
```

Re-export new types if needed:

```ts
export type ShareRequest = components['schemas']['ShareRequest']
export type ShareResponse = components['schemas']['ShareResponse']
```

`index.ts` requires no change — it already does `export * as {domain}`.

### 4. Add a unit test

Add to `src/shared/api/{domain}.test.ts`: mock `fetch`, assert URL/method/body and that non-2xx maps to the right `ApiError` subclass. See existing tests for shape.

### 5. Wire from a feature (if applicable)

In `src/features/<feature>/model/*.ts`:

```ts
import { action, wrap } from '@reatom/core'
import { notebook } from '@/shared/api'

export const share = action(async (id: string, body: notebook.ShareRequest) => {
  await wrap(notebook.shareNotebook(id, body))
}, 'notebook.share')
```

`wrap(...)` is mandatory — `clearStack()` is enabled (see `docs/architecture/reatom.md`).

## Checklist

- [ ] `openapi/{domain}.openapi.yaml` updated, `npx @redocly/cli lint` passes
- [ ] `pnpm api:generate` run, `src/shared/api/generated/openapi-ts/{domain}.d.ts` updated
- [ ] Thin function added to `src/shared/api/{domain}.ts`
- [ ] Test added to `src/shared/api/{domain}.test.ts`, `pnpm test` passes
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] No imports from `@/shared/api/generated/**` outside `src/shared/api/`

## Notes

- Errors: `toApiError` maps 400/401/404 to typed subclasses; other statuses get a generic `ApiError`. If you need a new typed error class, add it in `errors.ts` and extend the switch in `toApiError`.
- Authentication header is added automatically via the middleware in `client.ts`; consumers don't pass it.
- See [docs/architecture/api-layer.md](../docs/architecture/api-layer.md) for the full layer description.
