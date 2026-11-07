// Google and GitHub sign-in in the desktop app (Clerk's own buttons, caught
// below). They can't finish inside the
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

// Clerk's own Google/GitHub buttons stay in its forms, as on the web, but a
// click on one would load the provider inside the app window. A capturing
// listener on the window runs before Clerk's handlers, stops the click and
// starts the browser sign-in instead. Clerk names each button for styling
// with the provider (cl-socialButtonsBlockButton__google, or
// cl-socialButtonsIconButton__github when they're shown as icons); those
// names are part of its customization API. If a Clerk update ever changed
// them, the click would reach Clerk and open the provider in the browser
// without coming back, so check this after updating Clerk.
const SOCIAL_BUTTON_CLASS = /(?:^|\s)cl-socialButtons\w*Button__(google|github)(?:\s|$)/;

function providerOfClick(event) {
  for (let el = event.target; el && el !== document.body; el = el.parentElement) {
    const match = SOCIAL_BUTTON_CLASS.exec(typeof el.className === 'string' ? el.className : '');
    if (match) return match[1];
  }
  return null;
}

// Mounted once inside Clerk's provider (AuthSession): sends Clerk's social
// buttons through the browser, and signs in with each ticket main passes on.
export function useBrowserSignInTickets() {
  const clerk = useClerk();
  useEffect(() => {
    if (!canSignInWithBrowser) return undefined;
    const onClick = (event) => {
      const provider = providerOfClick(event);
      if (!provider) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (status.kind !== 'waiting' && status.kind !== 'finishing') startBrowserSignIn(provider);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);
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
