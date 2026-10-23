import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initDesktopStore } from './lib/desktop'
import { beginAppSession } from './lib/config'
import { installGlobalErrorLogging, logError, reactRootErrorOptions } from './lib/errorLog'

installGlobalErrorLogging()
const coldStart = beginAppSession()

// The Android app has no server, so it answers /api/* in the page
// (lib/android.js); loaded only there, before anything can call /api.
const startAndroidApi = () => (window.Capacitor?.getPlatform?.() === 'android'
  ? import('./lib/android.js').then((m) => m.installAndroidApi())
  : Promise.resolve())

// The desktop app loads saved projects from disk before the first render, so
// the synchronous storage helpers see them.
Promise.all([initDesktopStore(), startAndroidApi()]).then(() => {
  createRoot(document.getElementById('root'), reactRootErrorOptions).render(
    <StrictMode>
      <App coldStart={coldStart} />
    </StrictMode>,
  )
}).catch((err) => logError('Could not load saved projects; the app did not start', err))
