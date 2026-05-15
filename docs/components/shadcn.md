# Shadcn/UI Components

This project uses **shadcn/ui** with the **base-ui** renderer (not Radix UI). Components are copied into `src/shared/ui/` and owned by the project — they are not imported from a package.

---

## Installed components

| Component   | File               | Used in                         |
| ----------- | ------------------ | ------------------------------- |
| `Button`    | `ui/button.tsx`    | Every page, NotebookCell        |
| `Input`     | `ui/input.tsx`     | LoginPage, ShadcnComponentsPage |
| `Textarea`  | `ui/textarea.tsx`  | ShadcnComponentsPage            |
| `Separator` | `ui/separator.tsx` | CustomComponentsPage, AboutPage |
| `Skeleton`  | `ui/skeleton.tsx`  | ShadcnComponentsPage            |
| `Badge`     | `ui/badge.tsx`     | ShadcnComponentsPage, AboutPage |
| `Card`      | `ui/card.tsx`      | ShadcnComponentsPage            |
| `Table`     | `ui/table.tsx`     | ShadcnComponentsPage            |
| `Tabs`      | `ui/tabs.tsx`      | ShadcnComponentsPage            |
| `Alert`     | `ui/alert.tsx`     | ShadcnComponentsPage            |
| `Avatar`    | `ui/avatar.tsx`    | ShadcnComponentsPage            |
| `Switch`    | `ui/switch.tsx`    | ShadcnComponentsPage            |
| `Checkbox`  | `ui/checkbox.tsx`  | ShadcnComponentsPage            |
| `Select`    | `ui/select.tsx`    | ShadcnComponentsPage            |
| `Tooltip`   | `ui/tooltip.tsx`   | Sidebar (internal)              |
| `Sheet`     | `ui/sheet.tsx`     | Sidebar mobile drawer           |
| `Sidebar`   | `ui/sidebar.tsx`   | AppSidebar layout               |

---

## Adding a new shadcn component

```bash
pnpm dlx shadcn@latest add <component-name>
```

Example:

```bash
pnpm dlx shadcn@latest add dialog
```

If a literal `@/` folder appears at the project root after the command, move the files in (see the [alias quirk](../architecture/path-aliases.md#the-shadcn-alias-and-the--folder-quirk)):

```bash
mv @/shared/ui/*.tsx src/shared/ui/
rm -rf "@/"
```

---

## Component reference

### Button

```tsx
import { Button } from '@/shared/ui/button'
;<Button variant="default">Click me</Button>
```

| Prop       | Values                                                       | Default   |
| ---------- | ------------------------------------------------------------ | --------- |
| `variant`  | `default` `secondary` `outline` `ghost` `destructive` `link` | `default` |
| `size`     | `default` `sm` `lg` `icon` `icon-sm`                         | `default` |
| `disabled` | `boolean`                                                    | `false`   |

---

### Badge

```tsx
import { Badge } from '@/shared/ui/badge'
;<Badge variant="secondary">New</Badge>
```

| Prop      | Values                                        |
| --------- | --------------------------------------------- |
| `variant` | `default` `secondary` `outline` `destructive` |

---

### Input

```tsx
import { Input } from '@/shared/ui/input'
;<Input type="email" placeholder="you@example.com" />
```

Accepts all standard `<input>` HTML attributes.

---

### Textarea

```tsx
import { Textarea } from '@/shared/ui/textarea'
;<Textarea placeholder="Write something…" rows={4} />
```

Accepts all standard `<textarea>` HTML attributes.

---

### Card

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/shared/ui/card'
;<Card>
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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/ui/table'
;<Table>
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs'
;<Tabs defaultValue="one">
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
import { Alert, AlertTitle, AlertDescription } from '@/shared/ui/alert'
import { AlertCircle } from 'lucide-react'
;<Alert variant="destructive">
  <AlertCircle className="size-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>
```

| Prop      | Values                  |
| --------- | ----------------------- |
| `variant` | `default` `destructive` |

---

### Select

```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shared/ui/select'
;<Select onValueChange={(val) => console.log(val)}>
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
import { Switch } from '@/shared/ui/switch'
;<Switch checked={isOn} onCheckedChange={setIsOn} />
```

---

### Checkbox

```tsx
import { Checkbox } from '@/shared/ui/checkbox'
;<Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} />
```

---

### Separator

```tsx
import { Separator } from '@/shared/ui/separator'

<Separator />                          // horizontal (default)
<Separator orientation="vertical" />   // vertical
```

---

### Skeleton

```tsx
import { Skeleton } from '@/shared/ui/skeleton'

<Skeleton className="h-4 w-48" />          // text line placeholder
<Skeleton className="size-10 rounded-full" />  // avatar placeholder
```

---

## Design tokens

shadcn/ui uses CSS variables for theming. The variables are injected into `src/app/styles/index.css` during `shadcn init`. Dark mode is supported automatically via `@media (prefers-color-scheme: dark)`.

Key tokens:

| Variable        | Used for                             |
| --------------- | ------------------------------------ |
| `--primary`     | Primary buttons, active nav items    |
| `--muted`       | Subtle backgrounds, placeholder text |
| `--destructive` | Error states, destructive buttons    |
| `--sidebar`     | Sidebar background                   |
| `--card`        | Card and cell backgrounds            |
| `--border`      | All borders                          |
