import { BookText, LogIn, LayoutGrid, Puzzle, Info } from 'lucide-react'
import { urlAtom } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import {
  Sidebar,
  SidebarContent,
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

const navAuth: NavItem[] = [{ title: 'Login', icon: LogIn, url: '/login' }]

const navInfo: NavItem[] = [{ title: 'About', icon: Info, url: '/about' }]

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
        <NavGroup label="Components" items={navComponents} />
        <NavGroup label="Auth" items={navAuth} />
        <NavGroup label="Info" items={navInfo} />
      </SidebarContent>
    </Sidebar>
  )
}
