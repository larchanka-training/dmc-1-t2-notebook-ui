import { useState } from 'react'
import {
  BookText,
  Bot,
  Copy,
  LogIn,
  LogOut,
  LayoutGrid,
  Puzzle,
  Info,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Moon,
  Sun,
  Monitor,
  Trash2,
  CircleHelp,
} from 'lucide-react'
import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { userAtom } from '@/entities/session'
import { themeModeAtom, type ThemeMode } from '@/entities/theme'
import {
  createNotebookAction,
  notebookListResource,
  notebookTitleAtom,
  openNotebookInSlot,
  renameTargetAtom,
  deleteTargetAtom,
  activeNotebookIdAtom,
  LOCAL_NOTEBOOK_ID,
  shortcutsOpenAtom,
} from '@/features/notebook'
import { logoutAction } from '@/features/auth'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Input } from '@/shared/ui/input'
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
import { cn } from '@/shared/lib/cn'
import { LOGIN_PATH } from '@/shared/lib/paths'

// Up to two initials for the identity-menu avatar: first letters of the first
// two name words, else the first two characters of the label.
function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

// `url` is RELATIVE (no leading slash). The real href is prefixed with the
// app base (import.meta.env.BASE_URL — '/' normally, '/pr-<N>/' under a preview)
// so navigation stays inside the deployed base path.
type NavItem = { title: string; icon: typeof BookText; url: string }

const navMain: NavItem[] = [{ title: 'Notebook', icon: BookText, url: '' }]

const navComponents: NavItem[] = [
  { title: 'Shadcn UI', icon: LayoutGrid, url: 'components/shadcn' },
  { title: 'Custom', icon: Puzzle, url: 'components/custom' },
]

const navAi: NavItem[] = [{ title: 'LLM Playground', icon: Bot, url: 'llm-playground' }]

// About + Help render together at the bottom of the content area via
// `InfoGroup` (defined below, after the shared label/active styles), so they
// share one menu and the same item spacing as every other section.

// Identity menu, pinned in the sidebar footer (new-design-v2). Renders a
// compact avatar card for a signed-in user, or a Log-in link otherwise.
const AuthSection = reatomComponent(() => {
  const user = userAtom()

  if (!user) {
    return (
      <a
        href={LOGIN_PATH}
        className="flex items-center gap-2.5 rounded-[var(--radius-item)] p-1.5 text-sm font-medium transition-colors hover:bg-sidebar-accent"
      >
        <LogIn className="size-[18px] text-muted-foreground" />
        <span>Log in</span>
      </a>
    )
  }

  const label = user.displayName ?? user.email ?? 'Account'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-item)] p-1.5 text-left transition-colors hover:bg-sidebar-accent"
          >
            {/* new-design-v2 identity avatar: primary→violet gradient with
                white initials, not the default grey fallback. */}
            <Avatar className="size-[33px]">
              <AvatarFallback className="bg-[linear-gradient(135deg,var(--primary),color-mix(in_oklch,var(--primary)_55%,#6d28d9))] text-[13px] font-semibold text-white">
                {initialsOf(label)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
            <MoreVertical className="size-4 shrink-0 text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[calc(var(--anchor-width)-12px)] min-w-0"
      >
        <DropdownMenuItem variant="destructive" onClick={wrap(async () => logoutAction())}>
          <LogOut className="size-4" />
          <div className="flex flex-col">
            <span className="text-sm">Sign out</span>
            <span className="text-xs font-normal text-muted-foreground">End this session</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}, 'AuthSection')

// new-design-v2 active item: primary-tinted background + primary text/icon,
// overriding shadcn's default grey `sidebar-accent` active style.
const NAV_ACTIVE =
  'data-active:bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] data-active:font-semibold data-active:text-primary data-active:[&_svg]:text-primary'

// new-design-v2 section heading: uppercase, wide tracking.
const GROUP_LABEL = 'text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'

const NavGroup = reatomComponent(({ label, items }: { label: string; items: NavItem[] }) => {
  const { pathname } = urlAtom()
  return (
    <SidebarGroup>
      <SidebarGroupLabel className={GROUP_LABEL}>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const href = import.meta.env.BASE_URL + item.url
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  isActive={pathname === href}
                  className={NAV_ACTIVE}
                  render={<a href={href} />}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}, 'NavGroup')

// Info section: About (a route) + Help (an action that opens the shortcuts
// dialog) share one SidebarMenu so their spacing matches every other section.
const InfoGroup = reatomComponent(() => {
  const { pathname } = urlAtom()
  const aboutHref = import.meta.env.BASE_URL + 'about'
  return (
    // mt-auto pins Info to the bottom of the scrollable content area (above the
    // footer's account block), leaving the notebooks list to take the slack.
    <SidebarGroup className="mt-auto">
      <SidebarGroupLabel className={GROUP_LABEL}>Info</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === aboutHref}
              className={NAV_ACTIVE}
              render={<a href={aboutHref} />}
            >
              <Info />
              <span>About</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
}, 'InfoGroup')

// Per-row "…" menu (new-design-v2): Rename / Duplicate / Delete. Only Rename is
// wired, and only for the current notebook (focuses the editor's title field);
// Duplicate/Delete and any action on backend rows are presentational until the
// notebook-management epic (04). Revealed on row hover / when the menu is open.
// `onDelete` is omitted for the local-only welcome-seed floor (no backend
// identity, regenerated on boot) — that row shows no Delete item (#135).
function NotebookRowMenu({ onRename, onDelete }: { onRename?: () => void; onDelete?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Notebook actions"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[5px] text-muted-foreground opacity-0 transition-[opacity,background,color] hover:bg-[color-mix(in_oklch,var(--foreground)_9%,transparent)] hover:text-foreground group-hover/nb:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy className="size-4" />
          Duplicate
        </DropdownMenuItem>
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Default title for the quick "+" create (new-design-v2 uses "Untitled
// notebook"). Opening/renaming/switching notebooks is epic 04 — out of scope
// here; the list stays presentational.
const NEW_NOTEBOOK_TITLE = 'Untitled notebook'

const NotebooksGroup = reatomComponent(() => {
  const user = userAtom()
  const { pathname } = urlAtom()
  const items = notebookListResource.data()
  const createError = createNotebookAction.error()?.message
  // The local notebook opens at the notebook route — the same empty-path href
  // as the "Notebook" item in Workspace (BASE_URL + '').
  const notebookHref = import.meta.env.BASE_URL
  // The currently open notebook lives in the editor slot (its id is
  // `activeNotebookIdAtom`, #135). Surface it as a synthetic top entry with a
  // live title so it shows up and stays highlighted while editing. Full
  // open/switch across the backend list is epic 04.
  const currentTitle = notebookTitleAtom()
  const activeId = activeNotebookIdAtom()
  const [filter, setFilter] = useState('')

  if (!user) return null

  const onCreate = wrap(async () => {
    await createNotebookAction(NEW_NOTEBOOK_TITLE)
  })

  const filterText = filter.trim().toLowerCase()
  // Never list the open notebook twice: it is already shown as the synthetic
  // current-row above, so drop its id from the backend feed.
  const backendItems = items.filter((nb) => nb.id !== activeId)
  const filtered = filterText
    ? backendItems.filter((nb) => nb.title.toLowerCase().includes(filterText))
    : backendItems
  const currentMatchesFilter = !filterText || currentTitle.toLowerCase().includes(filterText)

  return (
    <SidebarGroup className="min-h-0 flex-1">
      <div className="flex shrink-0 items-center justify-between gap-1 pr-1">
        <SidebarGroupLabel className={GROUP_LABEL}>Notebooks</SidebarGroupLabel>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0 text-muted-foreground hover:text-primary"
          aria-label="New notebook"
          onClick={onCreate}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="relative shrink-0 px-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter notebooks…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-full pl-7 text-xs"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <SidebarMenu>
            {currentMatchesFilter ? (
              <SidebarMenuItem className="group/nb">
                <SidebarMenuButton
                  isActive={pathname === notebookHref}
                  className={cn(NAV_ACTIVE, 'pr-8')}
                  render={<a href={notebookHref} />}
                >
                  <span className="truncate">{currentTitle || NEW_NOTEBOOK_TITLE}</span>
                </SidebarMenuButton>
                <NotebookRowMenu
                  onRename={wrap(() =>
                    renameTargetAtom.set({
                      id: activeId,
                      title: currentTitle || NEW_NOTEBOOK_TITLE,
                    }),
                  )}
                  // The local-only welcome-seed floor cannot be deleted; only an
                  // open backend notebook gets a Delete item (#135).
                  onDelete={
                    activeId === LOCAL_NOTEBOOK_ID
                      ? undefined
                      : wrap(() =>
                          deleteTargetAtom.set({
                            id: activeId,
                            title: currentTitle || NEW_NOTEBOOK_TITLE,
                          }),
                        )
                  }
                />
              </SidebarMenuItem>
            ) : null}
            {filtered.map((nb) => (
              <SidebarMenuItem key={nb.id} className="group/nb">
                {/* Open-into-slot (#135): clicking a backend row loads it into the
                    single editor slot (lazy GET /notebooks/{id}) and navigates to
                    the notebook route so the editor is on screen. Once open it
                    becomes the active id and is shown as the synthetic current-row
                    above (filtered out of this list), so no URL state per id. */}
                <SidebarMenuButton
                  className="pr-8"
                  onClick={wrap(() => {
                    void openNotebookInSlot(nb.id)
                    urlAtom.set((url) => new URL(notebookHref, url.origin), true)
                  })}
                >
                  <span className="truncate">{nb.title}</span>
                </SidebarMenuButton>
                <NotebookRowMenu
                  onRename={wrap(() => renameTargetAtom.set({ id: nb.id, title: nb.title }))}
                  onDelete={wrap(() => deleteTargetAtom.set({ id: nb.id, title: nb.title }))}
                />
              </SidebarMenuItem>
            ))}
            {filterText && !currentMatchesFilter && filtered.length === 0 ? (
              <li className="px-2 text-xs text-muted-foreground">No matches.</li>
            ) : null}
          </SidebarMenu>
        </div>

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
    <Sidebar className="border-border">
      <SidebarHeader className="h-[60px] flex-row items-center gap-2.5 border-b border-border px-4 py-0">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-[var(--radius-item)] bg-primary font-mono text-[15px] font-semibold text-primary-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,black_8%,transparent)]">
          JS
        </span>
        <div className="min-w-0 leading-tight">
          <span className="block truncate text-base font-semibold tracking-tight">JS Notebook</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            Personal workspace
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-x-hidden">
        <NavGroup label="Workspace" items={navMain} />
        <NavGroup label="AI" items={navAi} />
        <NavGroup label="Components" items={navComponents} />
        <NotebooksGroup />
        <InfoGroup />
      </SidebarContent>
      <SidebarFooter className="gap-2.5 border-t border-border">
        <AuthSection />
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
      className="flex items-center gap-0.5 rounded-[var(--radius-card)] border border-border bg-muted p-[3px]"
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
            'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-item)] text-[13px] font-medium transition-[background,color,box-shadow]',
            mode === optionMode
              ? 'bg-card font-semibold text-foreground shadow-[var(--shadow-pop)]'
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
