# Skill: fix-shadcn-placement

Fix the file placement issue that occurs every time a shadcn component is
installed. shadcn writes files to a literal `@/` folder at the project root
instead of `src/` — this skill moves them to the correct location.

## When to run this

Run immediately after any `pnpm dlx shadcn@latest add ...` command.

Symptom — you see a new `@/` folder at the project root:
```
ui/
├── @/                ← wrong, should not exist
│   └── components/
│       └── ui/
│           └── dialog.tsx
├── src/
└── ...
```

## Fix

```bash
# 1. Move component files to src/
cp @/components/ui/*.tsx src/components/ui/

# 2. Move hooks if any were added
[ -d "@/hooks" ] && cp @/hooks/*.ts src/hooks/

# 3. Delete the misplaced folder
rm -rf "@/"

# 4. Verify
ls src/components/ui/
```

## Why this happens

shadcn reads the `@/` path alias from `components.json` and resolves it as a
**literal string** rather than following the Vite alias configuration.

In Next.js projects (shadcn's primary target), the alias is configured in
`jsconfig.json` / `tsconfig.json` at the root level in a way that shadcn's
file writer also reads. In Vite projects the alias is only in `vite.config.ts`
and `tsconfig.app.json` — shadcn's CLI does not read `vite.config.ts`.

## Permanent fix (not yet applied)

The long-term solution would be to add a `jsconfig.json` at the project root:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

This would make shadcn's CLI resolve `@/` correctly. Not applied yet because
it may conflict with the existing `tsconfig.app.json` setup.

## Related

- `docs/architecture/path-aliases.md` — full explanation of the alias setup
- `.agents/add-shadcn.md` — full workflow for adding a shadcn component
