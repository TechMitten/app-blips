import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DebugTools from './components/DebugTools.jsx'
import { initAnalytics } from './lib/analytics'
import { initDesktopStore } from './lib/desktop'

initAnalytics()

// The desktop app loads saved projects from disk before the first render, so
// the synchronous storage helpers see them (a no-op in the browser).
initDesktopStore().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
      <DebugTools />
    </StrictMode>,
  )
})
