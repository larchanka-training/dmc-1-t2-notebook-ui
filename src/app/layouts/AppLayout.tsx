import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/shared/ui/sidebar'
import { ShortcutsHelp } from '@/features/notebook'
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
      {/* Single global instance so the Help dialog works from any page
          (the sidebar's Help button lives outside the notebook view). */}
      <ShortcutsHelp />
    </SidebarProvider>
  )
}
