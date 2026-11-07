// Whether this copy of AppBlips has accounts (Clerk sign-in + plans) or is a
// local, single-user install that uses the person's own AI keys.
//
// Accounts are on only when both halves exist: the build has a Clerk
// publishable key, and the server answering /api/* says it is hosted (it has
// Clerk and Creem keys, see electron/server/hosted/mode.js). Anything else —
// Pinokio and other source installs with no .env, Docker, the desktop and
// Android apps, which have no billing server — runs with no sign-in, no
// paywall and the saved local keys. Decided once before the first render, so
// a signed-out visitor never sees the app flash before the sign-in modal.

import { createContext, useContext } from 'react';
import { fetchBillingConfig } from './billing';

export const CLERK_PUBLISHABLE_KEY = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();

export async function detectAccounts() {
  if (!CLERK_PUBLISHABLE_KEY) return false;
  return (await fetchBillingConfig()).hosted;
}

export const AccountsContext = createContext(false);

// True when sign-in UI (Clerk components) may be rendered. Clerk components
// throw outside a ClerkProvider, which exists only in this mode.
export const useAccounts = () => useContext(AccountsContext);
