import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/shared/ui/sidebar'
import { AppSidebar } from '@/components/common/AppSidebar'
import NotebookPage from '@/pages/NotebookPage'
import LoginPage from '@/pages/LoginPage'
import ShadcnComponentsPage from '@/pages/ShadcnComponentsPage'
import CustomComponentsPage from '@/pages/CustomComponentsPage'
import AboutPage from '@/pages/AboutPage'

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <SidebarTrigger />
        </header>
        <div className="flex flex-col flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<NotebookPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/components/shadcn" element={<ShadcnComponentsPage />} />
            <Route path="/components/custom" element={<CustomComponentsPage />} />
            <Route path="/about" element={<AboutPage />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<Layout />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
