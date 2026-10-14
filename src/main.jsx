import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initDesktopStore } from './lib/desktop'
import { beginAppSession } from './lib/config'
import { installGlobalErrorLogging, logError, reactRootErrorOptions } from './lib/errorLog'

installGlobalErrorLogging()
const coldStart = beginAppSession()

// The desktop app loads saved projects from disk before the first render, so
// the synchronous storage helpers see them.
initDesktopStore().then(() => {
  createRoot(document.getElementById('root'), reactRootErrorOptions).render(
    <StrictMode>
      <App coldStart={coldStart} />
    </StrictMode>,
  )
}).catch((err) => logError('Could not load saved projects; the app did not start', err))
