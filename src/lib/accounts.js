// Whether this copy of AppBlips has accounts (Clerk sign-in + plans) or is a
// local, single-user install that uses the person's own AI keys.
//
// Accounts are on only when both halves exist: the build has a Clerk
// publishable key, and the server answering /api/* says it is hosted (it has
// a Clerk key and a Polar token, see electron/server/hosted/mode.js). In the desktop
// app that server is the AppBlips Worker (electron/hostedApi.js), so desktop
// has accounts whenever it is online at startup. Anything else —
// Pinokio and other source installs with no .env, Docker, the Android app,
// which has no billing server — runs with no sign-in, no
// paywall and the saved local keys. Decided once before the first render, so
// a signed-out visitor never sees the app flash before the sign-in modal.

import { createContext, useContext } from 'react';
import { fetchBillingConfig } from './billing';
import { isDesktop } from './desktop';

// The desktop app always signs in to the production Clerk instance that the
// AppBlips Worker checks tokens against, whatever .env the build was made
// with (release builds have none: CI, the Store package built on a PC).
// Publishable keys are public by design; they only name the instance. Other
// builds take theirs from .env, and without one have no accounts.
const DESKTOP_CLERK_KEY = 'pk_live_Y2xlcmsuYXBwYmxpcHMuY29tJA';

export const CLERK_PUBLISHABLE_KEY = isDesktop
  ? DESKTOP_CLERK_KEY
  : String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();

export async function detectAccounts() {
  if (!CLERK_PUBLISHABLE_KEY) return false;
  return (await fetchBillingConfig()).hosted;
}

export const AccountsContext = createContext(false);

// True when sign-in UI (Clerk components) may be rendered. Clerk components
// throw outside a ClerkProvider, which exists only in this mode.
export const useAccounts = () => useContext(AccountsContext);
