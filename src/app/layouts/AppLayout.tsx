import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset } from '@/shared/ui/sidebar'
import { ShortcutsHelp } from '@/features/notebook'
import { AppSidebar } from './AppSidebar'
import { AppTopbar } from './AppTopbar'

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppTopbar />
        <div className="flex flex-col flex-1 overflow-auto">{children}</div>
      </SidebarInset>
      {/* Single global instance so the Help dialog works from any page
          (the sidebar's Help button lives outside the notebook view). */}
      <ShortcutsHelp />
    </SidebarProvider>
  )
}
