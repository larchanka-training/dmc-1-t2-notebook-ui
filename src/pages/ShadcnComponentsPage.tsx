import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, Info, CheckCircle2, Terminal } from 'lucide-react'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
      <div className="flex flex-wrap gap-3 items-start">{children}</div>
      <Separator />
    </div>
  )
}

const tableData = [
  { name: 'Alice Johnson', role: 'Developer', status: 'Active', score: 98 },
  { name: 'Bob Smith', role: 'Designer', status: 'Active', score: 87 },
  { name: 'Carol White', role: 'Manager', status: 'Away', score: 72 },
  { name: 'David Lee', role: 'Developer', status: 'Inactive', score: 55 },
]

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  Active: 'default',
  Away: 'secondary',
  Inactive: 'destructive',
}

export default function ShadcnComponentsPage() {
  const [inputVal, setInputVal] = useState('')
  const [textareaVal, setTextareaVal] = useState('')
  const [switchOn, setSwitchOn] = useState(false)
  const [checked, setChecked] = useState(false)
  const [selectVal, setSelectVal] = useState('')

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Shadcn UI Components</h1>
        <p className="text-muted-foreground mt-1 text-sm">Installed shadcn/ui components — live examples.</p>
      </div>

      {/* Button */}
      <Section title="Button">
        <Button variant="default">Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button size="icon" variant="outline">+</Button>
      </Section>

      {/* Badge */}
      <Section title="Badge">
        <Badge variant="default">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </Section>

      {/* Input & Textarea */}
      <Section title="Input & Textarea">
        <Input
          className="w-56"
          placeholder="Type something…"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
        />
        <Input className="w-56" placeholder="Disabled" disabled />
        <Input className="w-56" type="password" placeholder="Password" />
        <Textarea
          className="w-56"
          placeholder="Multiline input…"
          rows={3}
          value={textareaVal}
          onChange={e => setTextareaVal(e.target.value)}
        />
      </Section>

      {/* Select */}
      <Section title="Select">
        <Select value={selectVal} onValueChange={setSelectVal}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Pick a language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="js">JavaScript</SelectItem>
            <SelectItem value="ts">TypeScript</SelectItem>
            <SelectItem value="py">Python</SelectItem>
            <SelectItem value="rs">Rust</SelectItem>
          </SelectContent>
        </Select>
        {selectVal && <Badge variant="outline">{selectVal}</Badge>}
      </Section>

      {/* Switch & Checkbox */}
      <Section title="Switch & Checkbox">
        <div className="flex items-center gap-2">
          <Switch checked={switchOn} onCheckedChange={setSwitchOn} id="sw" />
          <label htmlFor="sw" className="text-sm cursor-pointer">
            {switchOn ? 'Enabled' : 'Disabled'}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="cb"
            checked={checked}
            onCheckedChange={v => setChecked(Boolean(v))}
          />
          <label htmlFor="cb" className="text-sm cursor-pointer">Accept terms</label>
        </div>
      </Section>

      {/* Avatar */}
      <Section title="Avatar">
        <Avatar>
          <AvatarFallback>AJ</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>BS</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>CW</AvatarFallback>
        </Avatar>
      </Section>

      {/* Alert */}
      <Section title="Alert">
        <div className="w-full space-y-2">
          <Alert>
            <Info className="size-4" />
            <AlertTitle>Info</AlertTitle>
            <AlertDescription>This is an informational alert message.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Something went wrong. Please try again.</AlertDescription>
          </Alert>
          <Alert className="border-green-500/50 text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>Your changes have been saved successfully.</AlertDescription>
          </Alert>
          <Alert>
            <Terminal className="size-4" />
            <AlertTitle>Heads up!</AlertTitle>
            <AlertDescription>You can add components using the shadcn CLI.</AlertDescription>
          </Alert>
        </div>
      </Section>

      {/* Card */}
      <Section title="Card">
        <Card className="w-72">
          <CardHeader>
            <CardTitle>JS Notebook</CardTitle>
            <CardDescription>Interactive JavaScript environment</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Write and run JavaScript directly in the browser. Output is captured inline below each cell.
            </p>
          </CardContent>
          <CardFooter className="gap-2">
            <Button size="sm">Open</Button>
            <Button size="sm" variant="outline">Learn more</Button>
          </CardFooter>
        </Card>

        <Card className="w-72">
          <CardHeader>
            <CardTitle>TARDIS T2</CardTitle>
            <CardDescription>Training group · 2026</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Badge>React</Badge>
            <Badge variant="secondary">TypeScript</Badge>
            <Badge variant="outline">Vite</Badge>
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="ghost" className="w-full">View members</Button>
          </CardFooter>
        </Card>
      </Section>

      {/* Tabs */}
      <Section title="Tabs">
        <Tabs defaultValue="preview" className="w-full max-w-lg">
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="docs">Docs</TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="rounded-md border p-4 mt-2 text-sm text-muted-foreground">
            This is the preview tab. Rendered output goes here.
          </TabsContent>
          <TabsContent value="code" className="rounded-md border p-4 mt-2 font-mono text-sm bg-muted/30">
            {`<Button variant="outline">Click me</Button>`}
          </TabsContent>
          <TabsContent value="docs" className="rounded-md border p-4 mt-2 text-sm text-muted-foreground">
            Full documentation and API reference goes here.
          </TabsContent>
        </Tabs>
      </Section>

      {/* Table */}
      <Section title="Table">
        <div className="w-full rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableData.map(row => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.role}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[row.status]}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{row.score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      {/* Skeleton */}
      <Section title="Skeleton">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </Section>

      {/* Separator */}
      <Section title="Separator">
        <div className="w-64 space-y-2">
          <p className="text-sm">Above the line</p>
          <Separator />
          <p className="text-sm">Below the line</p>
        </div>
        <div className="flex items-center gap-3 h-8">
          <span className="text-sm">Left</span>
          <Separator orientation="vertical" />
          <span className="text-sm">Right</span>
        </div>
      </Section>
    </div>
  )
}
