import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AuthSession from './components/AuthSession.jsx'
import { initDesktopStore } from './lib/desktop'
import { AccountsContext, CLERK_PUBLISHABLE_KEY, detectAccounts } from './lib/accounts'
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
// the synchronous storage helpers see them. Accounts are checked after the
// Android API is installed, since that is what answers /api/* there.
Promise.all([initDesktopStore(), startAndroidApi()]).then(detectAccounts).then((accounts) => {
  const app = <App coldStart={coldStart} />
  // Local installs (Pinokio, source, Docker, Android) never load Clerk: no
  // sign-in, and /api/chat uses the person's saved keys. With accounts,
  // signing in is optional: onboarding asks whether to use an own key or a
  // plan, and only the plan path signs in.
  createRoot(document.getElementById('root'), reactRootErrorOptions).render(
    <StrictMode>
      <AccountsContext.Provider value={accounts}>
        {accounts ? (
          <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
            <AuthSession>{app}</AuthSession>
          </ClerkProvider>
        ) : app}
      </AccountsContext.Provider>
    </StrictMode>,
  )
}).catch((err) => logError('Could not load saved projects; the app did not start', err))