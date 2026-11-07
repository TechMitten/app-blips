// Google and GitHub sign-in in the desktop app. They can't finish inside the
// app (Google refuses embedded windows, and the providers can't return to
// appblips://app), so main opens AppBlips' sign-in page in the browser
// (electron/hostedApi.js, worker/desktopAuth.js), which hands back a
// one-time Clerk sign-in ticket. This module tracks that round trip for the
// buttons and turns the ticket into a session.

import { useEffect, useSyncExternalStore } from 'react';
import { useClerk } from '@clerk/react';
import { desktopBridge } from './desktop';
import { logError } from './errorLog';

// { kind: 'idle' } | { kind: 'waiting', provider } | { kind: 'finishing' } | { kind: 'error', message }
let status = { kind: 'idle' };
const listeners = new Set();
const setStatus = (next) => {
  status = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useBrowserSignInStatus = () => useSyncExternalStore(subscribe, () => status);

export const canSignInWithBrowser = Boolean(desktopBridge?.auth);

export async function startBrowserSignIn(provider) {
  try {
    await desktopBridge.auth.start(provider);
    setStatus({ kind: 'waiting', provider });
  } catch (err) {
    logError(`Could not open the browser sign-in (${provider})`, err);
    setStatus({ kind: 'error', message: 'Could not open your web browser. Try again, or sign in with your email.' });
  }
}

export const cancelBrowserSignIn = () => setStatus({ kind: 'idle' });

// Mounted once inside Clerk's provider (AuthSession): signs in with each
// ticket main passes on, whichever button started it.
export function useBrowserSignInTickets() {
  const clerk = useClerk();
  useEffect(() => {
    if (!canSignInWithBrowser) return undefined;
    return desktopBridge.auth.onTicket(async (ticket) => {
      setStatus({ kind: 'finishing' });
      try {
        const signIn = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
        if (signIn.status !== 'complete' || !signIn.createdSessionId) throw new Error(`sign-in status ${signIn.status}`);
        await clerk.setActive({ session: signIn.createdSessionId });
        setStatus({ kind: 'idle' });
      } catch (err) {
        logError('Could not finish the browser sign-in', err);
        setStatus({ kind: 'error', message: 'Could not finish signing in. Try again.' });
      }
    });
  }, [clerk]);
}
