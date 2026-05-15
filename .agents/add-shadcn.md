# Skill: add-shadcn

Install a new shadcn/ui component, fix the file placement issue, and add it
to the shadcn components showcase page.

## Usage

Invoke this skill with the component name as it appears in the shadcn registry,
e.g. `dialog`, `popover`, `accordion`, `toast`.

## Steps

### 1. Install the component

```bash
pnpm dlx shadcn@latest add {component-name}
```

### 2. Fix file placement (always required)

shadcn writes files to a literal `@/` folder at the project root instead of `src/`.
Move them immediately after install:

```bash
# Move component files
cp @/components/ui/*.tsx src/components/ui/

# Move any hooks that were added (check if @/hooks/ exists)
[ -d "@/hooks" ] && cp @/hooks/*.ts src/hooks/

# Remove the misplaced folder
rm -rf "@/"
```

Verify the files are in the right place:

```bash
ls src/components/ui/
```

### 3. Add to ShadcnComponentsPage

Open `src/pages/ShadcnComponentsPage.tsx` and:

**Add the import** at the top:

```tsx
import { ComponentName, SubComponent } from '@/components/ui/{component-name}'
```

**Add a Section** in the JSX:

```tsx
<Section title="{ComponentName}">{/* live example here */}</Section>
```

### 4. Add to docs

Open `docs/components/shadcn.md` and add:

- An entry in the **Installed components** table
- A usage code block in the **Component reference** section

## Checklist

- [ ] Component installed via shadcn CLI
- [ ] Files moved from `@/components/ui/` to `src/components/ui/`
- [ ] `@/` folder deleted from project root
- [ ] Component imported and showcased in `ShadcnComponentsPage.tsx`
- [ ] Entry added to `docs/components/shadcn.md`
- [ ] App still runs with no console errors

## Known issue

This file placement bug exists because Vite resolves the `@/` alias differently
from Next.js (which shadcn is designed for). See
`docs/architecture/path-aliases.md#the-shadcn-alias-conflict` for details.
