import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/shared/ui/sidebar'
import { AppSidebar } from './AppSidebar'

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <SidebarTrigger />
        </header>
        <div className="flex flex-col flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
