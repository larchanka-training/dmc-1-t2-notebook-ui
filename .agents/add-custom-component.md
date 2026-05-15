# Skill: add-custom-component

Create a new custom component in `src/components/common/`, showcase it in
`CustomComponentsPage`, and document it in `docs/components/custom.md`.

## Usage

Invoke this skill with:

- component name (PascalCase, e.g. `ProgressBar`)
- brief description of what it does
- list of props it accepts

## Steps

### 1. Create the component file

Create `src/components/common/{ComponentName}.tsx`:

```tsx
export interface {ComponentName}Props {
  // define props here
}

/**
 * One-line description of what this component does.
 */
export function {ComponentName}({ ...props }: {ComponentName}Props) {
  return (
    <div>
      {/* implementation */}
    </div>
  )
}
```

Rules:

- Use a **named export**, not default export
- Export the props interface too so consumers can type-check
- Use `cn()` from `@/lib/utils` for conditional Tailwind classes
- Use shadcn primitives from `@/components/ui/` where possible

### 2. Add to CustomComponentsPage

Open `src/pages/CustomComponentsPage.tsx`:

**Add the import:**

```tsx
import { {ComponentName} } from '@/components/common/{ComponentName}'
```

**Add a Section with examples and PropTable:**

```tsx
<Section
  title="{ComponentName}"
  description="What this component does and when to use it."
>
  {/* show 2-3 variants or states */}
  <{ComponentName} {props} />

  <PropTable rows={[
    ['propName', 'type', 'description'],
  ]} />
</Section>
```

Show at least:

- The default state
- One variant or edge case
- The prop table with all props documented

### 3. Document in docs/components/custom.md

Add a section following the existing format:

````markdown
## {ComponentName}

**File:** `src/components/common/{ComponentName}.tsx`
**Used in:** list pages that use it

Description of the component.

### Props

| Prop     | Type | Required | Description  |
| -------- | ---- | -------- | ------------ |
| propName | type | yes/no   | what it does |

### Usage

\```tsx
import { {ComponentName} } from '@/components/common/{ComponentName}'

<{ComponentName} prop="value" />
\```

### Design notes

- Why certain choices were made
````

## Checklist

- [ ] Component file created in `src/components/common/`
- [ ] Props interface exported alongside the component
- [ ] Component imported and showcased in `CustomComponentsPage.tsx`
- [ ] At least 2 usage examples shown in the showcase
- [ ] PropTable lists all props with types and descriptions
- [ ] Section added to `docs/components/custom.md`
- [ ] No TypeScript errors (`pnpm build`)
