import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import NotebookPage from '@/pages/NotebookPage'
import LoginPage from '@/pages/LoginPage'
import ShadcnComponentsPage from '@/pages/ShadcnComponentsPage'
import CustomComponentsPage from '@/pages/CustomComponentsPage'
import AboutPage from '@/pages/AboutPage'

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
