import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { NotebookPage } from '@/pages/notebook'
import { LoginPage } from '@/pages/login'
import { ShadcnComponentsPage } from '@/pages/shadcn-components'
import { CustomComponentsPage } from '@/pages/custom-components'
import { AboutPage } from '@/pages/about'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<NotebookPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/components/shadcn" element={<ShadcnComponentsPage />} />
          <Route path="/components/custom" element={<CustomComponentsPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
