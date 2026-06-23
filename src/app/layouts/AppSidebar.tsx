import { useState } from 'react'
import {
  BookText,
  Bot,
  Copy,
  LogIn,
  LogOut,
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
  BookOpen,
} from 'lucide-react'
import { urlAtom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { userAtom } from '@/entities/session'
import { themeModeAtom, type ThemeMode } from '@/entities/theme'
import {
  createNotebookAction,
  promoteSeedFloorIfUnsynced,
  notebookListResource,
  notebookTitleAtom,
  openNotebookInSlot,
  slotOpenErrorAtom,
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
  const usageHref = import.meta.env.BASE_URL + 'usage'
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
            <SidebarMenuButton
              isActive={pathname === usageHref}
              className={NAV_ACTIVE}
              render={<a href={usageHref} />}
            >
              <BookOpen />
              <span>Usage</span>
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

// Per-row "…" menu (new-design-v2): Rename / Duplicate / Delete (#135). Rename
// (title edit) and Delete (confirm modal → server DELETE) are wired; `onDelete` is
// omitted for the local-only welcome-seed floor (no backend identity, regenerated
// on boot), so that row shows no Delete item. Duplicate is not implemented yet —
// it is rendered disabled with explicit coming-soon semantics rather than as a
// dead clickable item (review L7). Revealed on row hover / when the menu is open.
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
        <DropdownMenuItem disabled aria-disabled="true" title="Duplicate — coming soon">
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

// Default title for the quick "+" create (new-design-v2 uses "Untitled notebook").
// Open-into-slot, rename and delete are wired here (#135); multi-notebook routing
// / duplicate stay in epic 04.
const NEW_NOTEBOOK_EMOJIS = ['📓', '🧪', '🚀', '✨', '🧠'] as const
const NEW_NOTEBOOK_TITLE = 'Untitled notebook'

// TARDIS-167 (#1): pick a RANDOM emoji each time. A module-level incrementing
// counter reset to 0 on every page load, so after a reload the first create
// always got the same emoji (📓). A random pick has no cross-reload state.
function nextNotebookTitle(): string {
  const emoji = NEW_NOTEBOOK_EMOJIS[Math.floor(Math.random() * NEW_NOTEBOOK_EMOJIS.length)]
  return `${emoji} ${NEW_NOTEBOOK_TITLE}`
}

const NotebooksGroup = reatomComponent(() => {
  const user = userAtom()
  const { pathname } = urlAtom()
  // TARDIS-167 (№8): gate on the signed-in user BEFORE reading
  // `notebookListResource.data()`. Reading it makes the resource hot, which
  // fires `GET /notebooks` — and the sidebar is mounted on EVERY route (incl.
  // /login), so without this early return the list was fetched before sign-in.
  // `useState` stays above the conditional return so hook order is stable.
  const [filter, setFilter] = useState('')
  if (!user) return null

  const items = notebookListResource.data()
  const createError = createNotebookAction.error()?.message
  const openError = slotOpenErrorAtom()
  // The local notebook opens at the notebook route — the same empty-path href
  // as the "Notebook" item in Workspace (BASE_URL + '').
  const notebookHref = import.meta.env.BASE_URL
  // The notebook open in the editor slot is identified by `activeNotebookIdAtom`
  // (#135). Its row stays in place in the backend list and is highlighted; only
  // when the active id is NOT in the list (the local welcome floor) is a single
  // synthetic row surfaced for it (see `showFloorRow`). `currentTitle` is the live
  // editor title, shown on the active row so it reflects in-progress edits.
  const currentTitle = notebookTitleAtom()
  const activeId = activeNotebookIdAtom()
  // FU3: disable the "+" while a create is in flight, so a double-click cannot
  // fire two concurrent createNotebookAction calls (each pushing an optimistic
  // row + a list retry, which can transiently drop or mis-roll-back a row).
  const creating = !createNotebookAction.ready()

  const onCreate = wrap(async () => {
    // TARDIS-167 (#9): if an unsynced welcome-seed floor is open, give it a
    // backend identity FIRST so it stays a listed row instead of vanishing once
    // the new notebook becomes active. Best-effort — never blocks the create.
    await wrap(promoteSeedFloorIfUnsynced())
    const created = await wrap(createNotebookAction(nextNotebookTitle()))
    if (!created) return
    const outcome = await wrap(openNotebookInSlot(created.id))
    if (outcome === 'opened' || outcome === 'already') {
      urlAtom.set((url) => new URL(notebookHref, url.origin), true)
    }
  })

  const filterText = filter.trim().toLowerCase()
  const filtered = filterText
    ? items.filter((nb) => nb.title.toLowerCase().includes(filterText))
    : items
  // The active notebook keeps its place in the list and is just highlighted (no
  // "jump to top"). Only when it is NOT in the backend list (the local welcome
  // floor before its first sync, or a not-yet-loaded list) do we surface a single
  // synthetic row for it so the open notebook is always visible.
  const activeInList = items.some((nb) => nb.id === activeId)
  const showFloorRow =
    !activeInList &&
    (!filterText || (currentTitle || NEW_NOTEBOOK_TITLE).toLowerCase().includes(filterText))
  // B-1 (TARDIS-167 №23): the user must always keep at least one notebook, so the
  // Delete affordance is hidden when only one slot exists. Count the real backend
  // rows plus the synthetic floor row (the welcome seed before its first sync).
  // `deleteNotebookAction` enforces the same rule at the model level.
  const canDelete = items.length + (showFloorRow ? 1 : 0) > 1

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
          disabled={creating}
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
            {/* The local welcome floor (or a not-yet-listed active notebook) shown
                as a single synthetic row, ONLY when it isn't in the backend list.
                A listed active notebook stays in place below and is highlighted. */}
            {showFloorRow ? (
              <SidebarMenuItem className="group/nb">
                <SidebarMenuButton
                  isActive={pathname === notebookHref}
                  className={cn(NAV_ACTIVE, 'pr-8')}
                  render={<a href={notebookHref} />}
                >
                  {/* TARDIS-167 (№20): native tooltip with the full title — long
                      names are clipped by the sidebar width. */}
                  <span className="truncate" title={currentTitle || NEW_NOTEBOOK_TITLE}>
                    {currentTitle || NEW_NOTEBOOK_TITLE}
                  </span>
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
                    activeId === LOCAL_NOTEBOOK_ID || !canDelete
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
            {filtered.map((nb) => {
              const isActive = nb.id === activeId
              // For the active row show the live editor title (it may differ from
              // the last-loaded list row while the user types before a list refetch).
              const title = isActive ? currentTitle || nb.title : nb.title
              return (
                <SidebarMenuItem key={nb.id} className="group/nb">
                  {/* Open-into-slot (#135): clicking a row loads it into the single
                      editor slot (GET /notebooks/{id}) and navigates to the notebook
                      route. The active row stays in place and is highlighted — no
                      reordering. */}
                  <SidebarMenuButton
                    isActive={isActive && pathname === notebookHref}
                    className={cn(isActive && NAV_ACTIVE, 'pr-8')}
                    onClick={wrap(async () => {
                      // Gate navigation on a successful open (CL-5): a failed/dropped
                      // open keeps the previous slot, so moving the URL would leave the
                      // editor showing a different notebook than the route implies. The
                      // controller surfaces the failure via `slotOpenErrorAtom`.
                      // `await wrap(...)` re-binds the Reatom frame so the `urlAtom.set`
                      // continuation runs in-frame under production clearStack()
                      // (otherwise it throws `missing async stack`).
                      const outcome = await wrap(openNotebookInSlot(nb.id))
                      if (outcome === 'opened' || outcome === 'already') {
                        urlAtom.set((url) => new URL(notebookHref, url.origin), true)
                      }
                    })}
                  >
                    {/* TARDIS-167 (№20): native tooltip with the full title. */}
                    <span className="truncate" title={title}>
                      {title}
                    </span>
                  </SidebarMenuButton>
                  <NotebookRowMenu
                    onRename={wrap(() => renameTargetAtom.set({ id: nb.id, title }))}
                    // Defence-in-depth (M5): never offer Delete for the local
                    // welcome floor, even if it ever appears as a list row.
                    onDelete={
                      nb.id === LOCAL_NOTEBOOK_ID || !canDelete
                        ? undefined
                        : wrap(() => deleteTargetAtom.set({ id: nb.id, title }))
                    }
                  />
                </SidebarMenuItem>
              )
            })}
            {filterText && !showFloorRow && filtered.length === 0 ? (
              <li className="px-2 text-xs text-muted-foreground">No matches.</li>
            ) : null}
          </SidebarMenu>
        </div>

        {createError ? (
          <p role="alert" className="px-2 text-xs text-destructive">
            {createError}
          </p>
        ) : null}
        {openError ? (
          <p role="alert" className="px-2 text-xs text-destructive">
            {openError}
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
