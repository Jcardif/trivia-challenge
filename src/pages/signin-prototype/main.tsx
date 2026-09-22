import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import SignInPagePrototype from '../SignInPage.prototype'

if (!import.meta.env.DEV) throw new Error('This prototype is local-only.')

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/signin" element={<SignInPagePrototype />} />
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  </BrowserRouter>
)
