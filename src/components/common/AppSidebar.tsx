import { BookText, LogIn, LayoutGrid, Puzzle, Info } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
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
} from '@/components/ui/sidebar'

const navMain = [
  { title: 'Notebook', icon: BookText, url: '/' },
]

const navComponents = [
  { title: 'Shadcn UI', icon: LayoutGrid, url: '/components/shadcn' },
  { title: 'Custom', icon: Puzzle, url: '/components/custom' },
]

const navAuth = [
  { title: 'Login', icon: LogIn, url: '/login' },
]

const navInfo = [
  { title: 'About', icon: Info, url: '/about' },
]

function NavGroup({ label, items }: { label: string; items: typeof navMain }) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                isActive={location.pathname === item.url}
                render={<a href={item.url} onClick={(e) => { e.preventDefault(); navigate(item.url) }} />}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

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
