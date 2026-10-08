import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initDesktopStore } from './lib/desktop'
import { beginAppSession } from './lib/config'

const coldStart = beginAppSession()

// The desktop app loads saved projects from disk before the first render, so
// the synchronous storage helpers see them.
initDesktopStore().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App coldStart={coldStart} />
    </StrictMode>,
  )
})
