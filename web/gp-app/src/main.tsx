import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

// Theme before paint
try {
  const t = localStorage.getItem('dga_theme')
  document.documentElement.setAttribute(
    'data-theme',
    t === 'dark' || t === 'light' ? t : 'light',
  )
} catch {
  document.documentElement.setAttribute('data-theme', 'light')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
