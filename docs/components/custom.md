# Custom Components

Custom components live in `src/components/common/`. They are built on top of shadcn/ui primitives and are specific to this project.

---

## NotebookCell

**File:** `src/components/common/NotebookCell.tsx`
**Used in:** `NotebookPage`, `CustomComponentsPage`

The core UI building block of the notebook. Renders a dark code editor with an output area below it. The component is fully **stateless** — the parent manages all state and passes callbacks as props.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `index` | `number` | yes | Cell number shown in the `[n]` badge in the header |
| `code` | `string` | yes | Source code displayed in the editor textarea |
| `output` | `string` | no | Text output shown below the editor after running |
| `status` | `'idle' \| 'running' \| 'done' \| 'error'` | no | Controls border colour and run button icon |
| `isFirst` | `boolean` | no | Disables the move-up button |
| `isLast` | `boolean` | no | Disables the move-down button |
| `readOnly` | `boolean` | no | Prevents editing the textarea |
| `onCodeChange` | `(code: string) => void` | no | Called on every keystroke |
| `onRun` | `() => void` | no | Called when play button or Cmd+Enter is pressed |
| `onDelete` | `() => void` | no | Called when the trash icon is clicked |
| `onMoveUp` | `() => void` | no | Called when the ↑ button is clicked |
| `onMoveDown` | `() => void` | no | Called when the ↓ button is clicked |

### Usage

```tsx
import { NotebookCell } from '@/components/common/NotebookCell'

// Minimal — static display only
<NotebookCell
  index={1}
  code={`console.log("hello")`}
  output="hello"
  status="done"
  readOnly
/>

// Full — wired to parent state
<NotebookCell
  index={idx + 1}
  code={cell.code}
  output={cell.output}
  status={cell.status}
  isFirst={idx === 0}
  isLast={idx === cells.length - 1}
  onCodeChange={code => updateCell(cell.id, { code })}
  onRun={() => runCell(cell.id)}
  onDelete={() => deleteCell(cell.id)}
  onMoveUp={() => moveCell(cell.id, -1)}
  onMoveDown={() => moveCell(cell.id, 1)}
/>
```

### Status visual reference

| Status | Border | Run button | Output text colour |
|---|---|---|---|
| `idle` | default | ▶ green | — |
| `running` | default | ⟳ spinner | — |
| `done` | default | ▶ green | foreground |
| `error` | red | ▶ green | destructive (red) |

### Design notes
- The editor background is `#1e1e2e` (Catppuccin Mocha dark) with `#cdd6f4` text — a deliberate visual contrast from the rest of the light/dark app theme
- The textarea auto-resizes to fit content using `scrollHeight`
- Action buttons are hidden (`opacity-0`) and revealed on hover (`group-hover:opacity-100`) to keep the UI clean when reading

---

## Badge

**File:** inline in `src/pages/CustomComponentsPage.tsx`

A compact status label with semantic colour variants. Lighter than the shadcn `Badge` — no border, rounded-full shape.

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `label` | `string` | — | Text content |
| `color` | `'default' \| 'success' \| 'warning' \| 'error'` | `'default'` | Background and text colour |

### Usage

```tsx
<Badge label="Active" color="success" />
<Badge label="Pending" color="warning" />
<Badge label="Failed" color="error" />
<Badge label="Unknown" />
```

### Colour mapping

| Value | Background | Text |
|---|---|---|
| `default` | `bg-muted` | `text-muted-foreground` |
| `success` | `bg-green-500/15` | `text-green-600` |
| `warning` | `bg-yellow-500/15` | `text-yellow-600` |
| `error` | `bg-red-500/15` | `text-red-600` |

---

## StatCard

**File:** inline in `src/pages/CustomComponentsPage.tsx`

A metric display card for dashboards. Shows a label, a large primary value, and an optional delta trend line.

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `label` | `string` | yes | Small descriptor above the value |
| `value` | `string` | yes | The primary metric — displayed large |
| `delta` | `string` | no | Trend vs previous period — shown in green |

### Usage

```tsx
<StatCard label="Total Students" value="1,284" delta="+12% this week" />
<StatCard label="Courses" value="48" />
```

### Design notes
- Uses `rounded-xl border bg-card` from the design system
- `delta` is always rendered green — it is assumed to be a positive trend. Extend with a `deltaColor` prop if needed

---

## CodeTag

**File:** inline in `src/pages/CustomComponentsPage.tsx`

Inline monospace code snippet for use inside prose or UI labels.

### Props

| Prop | Type | Description |
|---|---|---|
| `children` | `string` | The code text to display |

### Usage

```tsx
<CodeTag>pnpm install</CodeTag>
<CodeTag>git commit -m "feat"</CodeTag>
```

### Design notes
- Renders as `<code>` with `bg-muted`, small padding, and `font-mono`
- Intentionally minimal — for longer code blocks use the notebook cell editor

---

## executeJS (utility, not a component)

**File:** `src/lib/executeJS.ts`

Not a React component — a pure async function that executes a JavaScript string and returns its output.

```ts
const { output, error } = await executeJS(`console.log(2 + 2)`)
// output: "4"
// error: false
```

| Return field | Type | Description |
|---|---|---|
| `output` | `string` | All captured console lines + return value, joined with `\n` |
| `error` | `boolean` | `true` if an exception was thrown |

See [How the Notebook Works](../notebook/how-it-works.md) for the full implementation breakdown.
