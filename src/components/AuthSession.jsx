import { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { setAuthTokenGetter } from '../lib/authToken';
import { fetchSandboxStatus, setSandboxComputerEnabled } from '../lib/sandboxComputer';
import { AccountDialogsProvider } from './AccountDialogs';
import { useBrowserSignInTickets } from '../lib/browserSignIn';

// Shares the Clerk session with non-React code (the chat transport, billing
// and sandbox helpers). Nothing here forces a sign-in: signing in is how a
// person chooses a plan (onboarding's "Subscribe to a plan", or Settings →
// Plan), and signed-out people build with their own AI key. So a session is
// only handed out while someone is signed in; the server treats a request
// with one as a plan user and one without as an own-key user.
export default function AuthSession({ children }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // Desktop: finish Google/GitHub sign-ins that came back from the browser.
  useBrowserSignInTickets();

  useEffect(() => {
    setAuthTokenGetter(isSignedIn ? getToken : null);
    return () => setAuthTokenGetter(null);
  }, [isSignedIn, getToken]);

  // The sandbox computer is for signed-in paid plans only; re-ask the server
  // whenever that can have changed, so the AI stops (or starts) being offered
  // the tool without a reload. Signed out can never have it, so that case
  // just turns the tool off instead of asking (and logging a 401).
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) fetchSandboxStatus();
    else setSandboxComputerEnabled(false);
  }, [isLoaded, isSignedIn]);

  return <AccountDialogsProvider>{children}</AccountDialogsProvider>;
}
