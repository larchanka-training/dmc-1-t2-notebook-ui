# Shadcn/UI Components

This project uses **shadcn/ui** with the **base-ui** renderer (not Radix UI). Components are copied into `src/components/ui/` and owned by the project — they are not imported from a package.

---

## Installed components

| Component | File | Used in |
|---|---|---|
| `Button` | `ui/button.tsx` | Every page, NotebookCell |
| `Input` | `ui/input.tsx` | LoginPage, ShadcnComponentsPage |
| `Textarea` | `ui/textarea.tsx` | ShadcnComponentsPage |
| `Separator` | `ui/separator.tsx` | CustomComponentsPage, AboutPage |
| `Skeleton` | `ui/skeleton.tsx` | ShadcnComponentsPage |
| `Badge` | `ui/badge.tsx` | ShadcnComponentsPage, AboutPage |
| `Card` | `ui/card.tsx` | ShadcnComponentsPage |
| `Table` | `ui/table.tsx` | ShadcnComponentsPage |
| `Tabs` | `ui/tabs.tsx` | ShadcnComponentsPage |
| `Alert` | `ui/alert.tsx` | ShadcnComponentsPage |
| `Avatar` | `ui/avatar.tsx` | ShadcnComponentsPage |
| `Switch` | `ui/switch.tsx` | ShadcnComponentsPage |
| `Checkbox` | `ui/checkbox.tsx` | ShadcnComponentsPage |
| `Select` | `ui/select.tsx` | ShadcnComponentsPage |
| `Tooltip` | `ui/tooltip.tsx` | Sidebar (internal) |
| `Sheet` | `ui/sheet.tsx` | Sidebar mobile drawer |
| `Sidebar` | `ui/sidebar.tsx` | AppSidebar layout |

---

## Adding a new shadcn component

```bash
pnpm dlx shadcn@latest add <component-name>
```

Example:
```bash
pnpm dlx shadcn@latest add dialog
```

Then move the files (see the [alias quirk](../architecture/path-aliases.md#the-shadcn-alias-conflict)):

```bash
cp @/components/ui/*.tsx src/components/ui/
rm -rf "@/"
```

---

## Component reference

### Button

```tsx
import { Button } from '@/components/ui/button'

<Button variant="default">Click me</Button>
```

| Prop | Values | Default |
|---|---|---|
| `variant` | `default` `secondary` `outline` `ghost` `destructive` `link` | `default` |
| `size` | `default` `sm` `lg` `icon` `icon-sm` | `default` |
| `disabled` | `boolean` | `false` |

---

### Badge

```tsx
import { Badge } from '@/components/ui/badge'

<Badge variant="secondary">New</Badge>
```

| Prop | Values |
|---|---|
| `variant` | `default` `secondary` `outline` `destructive` |

---

### Input

```tsx
import { Input } from '@/components/ui/input'

<Input type="email" placeholder="you@example.com" />
```

Accepts all standard `<input>` HTML attributes.

---

### Textarea

```tsx
import { Textarea } from '@/components/ui/textarea'

<Textarea placeholder="Write something…" rows={4} />
```

Accepts all standard `<textarea>` HTML attributes.

---

### Card

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle</CardDescription>
  </CardHeader>
  <CardContent>Body content</CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>
```

---

### Table

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Role</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Alice</TableCell>
      <TableCell>Developer</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

---

### Tabs

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

<Tabs defaultValue="one">
  <TabsList>
    <TabsTrigger value="one">Tab One</TabsTrigger>
    <TabsTrigger value="two">Tab Two</TabsTrigger>
  </TabsList>
  <TabsContent value="one">Content for tab one</TabsContent>
  <TabsContent value="two">Content for tab two</TabsContent>
</Tabs>
```

---

### Alert

```tsx
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

<Alert variant="destructive">
  <AlertCircle className="size-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>
```

| Prop | Values |
|---|---|
| `variant` | `default` `destructive` |

---

### Select

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

<Select onValueChange={(val) => console.log(val)}>
  <SelectTrigger className="w-48">
    <SelectValue placeholder="Choose one" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
  </SelectContent>
</Select>
```

---

### Switch

```tsx
import { Switch } from '@/components/ui/switch'

<Switch checked={isOn} onCheckedChange={setIsOn} />
```

---

### Checkbox

```tsx
import { Checkbox } from '@/components/ui/checkbox'

<Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} />
```

---

### Separator

```tsx
import { Separator } from '@/components/ui/separator'

<Separator />                          // horizontal (default)
<Separator orientation="vertical" />   // vertical
```

---

### Skeleton

```tsx
import { Skeleton } from '@/components/ui/skeleton'

<Skeleton className="h-4 w-48" />          // text line placeholder
<Skeleton className="size-10 rounded-full" />  // avatar placeholder
```

---

## Design tokens

shadcn/ui uses CSS variables for theming. The variables are injected into `src/index.css` during `shadcn init`. Dark mode is supported automatically via `@media (prefers-color-scheme: dark)`.

Key tokens:

| Variable | Used for |
|---|---|
| `--primary` | Primary buttons, active nav items |
| `--muted` | Subtle backgrounds, placeholder text |
| `--destructive` | Error states, destructive buttons |
| `--sidebar` | Sidebar background |
| `--card` | Card and cell backgrounds |
| `--border` | All borders |
