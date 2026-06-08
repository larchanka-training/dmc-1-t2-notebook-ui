import type { ReactNode } from 'react'
import { SidebarProvider, SidebarInset } from '@/shared/ui/sidebar'
import { ShortcutsHelp } from '@/features/notebook'
import { AppSidebar } from './AppSidebar'
import { AppTopbar } from './AppTopbar'

export function AppLayout({ children }: { children?: ReactNode }) {
  return (
    // Pin the shell to the viewport (height + overflow-hidden) so only the
    // content area below the fixed topbar scrolls — the topbar stays put and
    // the outline's sticky positioning has a real scroll port to latch onto.
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar />
      <SidebarInset className="min-h-0">
        <AppTopbar />
        {/* Plain block scroll port (not flex): `position: sticky` descendants
            misbehave inside a scrolling flex container in some engines — the
            outline would detach mid-scroll. A block container (like the
            prototype's .view) gives sticky a clean scroll context. */}
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
      {/* Single global instance so the Help dialog works from any page
          (the sidebar's Help button lives outside the notebook view). */}
      <ShortcutsHelp />
    </SidebarProvider>
  )
}
