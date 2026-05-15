import type { ReactNode } from 'react'
import { TooltipProvider } from '@/shared/ui/tooltip'

export function AppProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}
