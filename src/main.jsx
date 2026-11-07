import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import SubscriptionGate from './components/SubscriptionGate.jsx'
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
  const app = (
    <SubscriptionGate>
      <App coldStart={coldStart} />
    </SubscriptionGate>
  )
  // Local installs (Pinokio, source, Docker, desktop) never load Clerk: no
  // sign-in, and /api/chat uses the person's saved keys.
  createRoot(document.getElementById('root'), reactRootErrorOptions).render(
    <StrictMode>
      <AccountsContext.Provider value={accounts}>
        {accounts ? (
          <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
            <RequireAuth>{app}</RequireAuth>
          </ClerkProvider>
        ) : app}
      </AccountsContext.Provider>
    </StrictMode>,
  )
}).catch((err) => logError('Could not load saved projects; the app did not start', err))