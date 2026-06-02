import { useState } from 'react'
import {
  BookText,
  LogIn,
  LogOut,
  LayoutGrid,
  Puzzle,
  Info,
  NotebookPen,
  Plus,
  Search,
  Moon,
  Sun,
  Monitor,
  CircleHelp,
} from 'lucide-react'
import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { userAtom } from '@/entities/session'
import { themeModeAtom, type ThemeMode } from '@/entities/theme'
import { createNotebookAction, notebookListResource, shortcutsOpenAtom } from '@/features/notebook'
import { logoutAction } from '@/features/auth'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { cn } from '@/shared/lib/cn'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/shared/ui/sidebar'

type NavItem = { title: string; icon: typeof BookText; url: string }

const navMain: NavItem[] = [{ title: 'Notebook', icon: BookText, url: '/' }]

const navComponents: NavItem[] = [
  { title: 'Shadcn UI', icon: LayoutGrid, url: '/components/shadcn' },
  { title: 'Custom', icon: Puzzle, url: '/components/custom' },
]

const navInfo: NavItem[] = [{ title: 'About', icon: Info, url: '/about' }]

// Help is an action (opens the shortcuts dialog), not a route, so it can't go
// through NavGroup's <a>. It sits right under the Info group.
const HelpButton = reatomComponent(() => {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={wrap(() => shortcutsOpenAtom.set(true))}>
              <CircleHelp />
              <span>Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}, 'HelpButton')

const AuthSection = reatomComponent(() => {
  const user = userAtom()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Account</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {user ? (
            <>
              <SidebarMenuItem>
                <div className="px-2 py-1 text-xs text-muted-foreground truncate">
                  {user.displayName ?? user.email}
                </div>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={wrap(async () => logoutAction())}>
                  <LogOut />
                  <span>Log out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          ) : (
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href="/login" />}>
                <LogIn />
                <span>Log in</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}, 'AuthSection')

const NavGroup = reatomComponent(({ label, items }: { label: string; items: NavItem[] }) => {
  const { pathname } = urlAtom()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton isActive={pathname === item.url} render={<a href={item.url} />}>
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}, 'NavGroup')

const NotebooksGroup = reatomComponent(() => {
  const user = userAtom()
  const items = notebookListResource.data()
  const isLoading = !notebookListResource.ready()
  const createError = createNotebookAction.error()?.message
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState('')

  if (!user) return null

  const onCreate = wrap(async () => {
    const created = await createNotebookAction(title)
    if (created) setTitle('')
  })

  const filterText = filter.trim().toLowerCase()
  const filtered = filterText
    ? items.filter((nb) => nb.title.toLowerCase().includes(filterText))
    : items

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Notebooks</SidebarGroupLabel>
      <SidebarGroupContent className="space-y-2">
        {items.length > 5 ? (
          <div className="relative px-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter notebooks"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
        ) : null}

        <ScrollArea className="max-h-72">
          <SidebarMenu>
            {filtered.map((nb) => (
              <SidebarMenuItem key={nb.id}>
                <SidebarMenuButton>
                  <NotebookPen />
                  <span className="truncate">{nb.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {!isLoading && items.length === 0 ? (
              <li className="px-2 text-xs text-muted-foreground">No notebooks yet.</li>
            ) : null}
            {filterText && filtered.length === 0 ? (
              <li className="px-2 text-xs text-muted-foreground">No matches.</li>
            ) : null}
          </SidebarMenu>
        </ScrollArea>

        <form
          className="flex items-center gap-1 px-1"
          onSubmit={wrap((e) => {
            e.preventDefault()
            onCreate()
          })}
        >
          <Input
            placeholder="New notebook"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-xs"
          />
          <Button size="icon" type="submit" variant="ghost" disabled={!title.trim()}>
            <Plus className="size-3.5" />
          </Button>
        </form>

        {createError ? (
          <p role="alert" className="px-2 text-xs text-destructive">
            {createError}
          </p>
        ) : null}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}, 'NotebooksGroup')

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <BookText className="size-5 text-primary" />
          <span className="font-semibold text-base tracking-tight">JS Notebook</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Workspace" items={navMain} />
        <NotebooksGroup />
        <NavGroup label="Components" items={navComponents} />
        <AuthSection />
        <NavGroup label="Info" items={navInfo} />
        <HelpButton />
      </SidebarContent>
      <SidebarFooter className="border-t">
        <ThemeToggle />
      </SidebarFooter>
    </Sidebar>
  )
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; Icon: typeof Sun }> = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'system', label: 'System', Icon: Monitor },
  { mode: 'dark', label: 'Dark', Icon: Moon },
]

const ThemeToggle = reatomComponent(() => {
  const mode = themeModeAtom()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {THEME_OPTIONS.map(({ mode: optionMode, label, Icon }) => (
        <button
          key={optionMode}
          type="button"
          role="radio"
          aria-checked={mode === optionMode}
          aria-label={label}
          title={`${label} theme`}
          className={cn(
            'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors',
            mode === optionMode
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={wrap(() => themeModeAtom.set(optionMode))}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}, 'ThemeToggle')
