import { useEffect, useState } from 'react';
import { SignIn, useAuth } from '@clerk/react';
import { setAuthTokenGetter } from '../lib/authToken';

// Signed-out visitors get a sign-in modal they cannot close: a dimmed,
// blurred backdrop over the running app with the Clerk card centred on
// it. There is deliberately no close affordance, and Escape or backdrop
// clicks do nothing -- the only way past it is to sign in. While it is
// up the app behind is inert (not clickable or tabbable).
//
// The modal waits for the launch splash video to leave the screen (its
// natural end, Skip, or Esc) so the branded intro plays unobstructed.
// The splash mounts a frame or two after the gate, so "no video yet"
// only counts once a brief grace period has passed; with the splash
// disabled outright the modal opens right after that grace.
export default function RequireAuth({ children }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  // Let the chat transport and billing helpers attach this session to
  // their requests. Cleared on unmount so nothing keeps a stale session.
  useEffect(() => {
    setAuthTokenGetter(getToken);
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || isSignedIn) return undefined;
    const startedAt = Date.now();
    let sawSplash = false;
    const splashGone = () => !document.querySelector('video[aria-label="AppBlips"]');
    const timer = window.setInterval(() => {
      if (!splashGone()) {
        sawSplash = true;
        return;
      }
      if (!sawSplash && Date.now() - startedAt < 600) return;
      window.clearInterval(timer);
      setSplashDone(true);
    }, 150);
    return () => window.clearInterval(timer);
  }, [isLoaded, isSignedIn]);

  // Brief blank beat while Clerk restores the session; rendering the app
  // optimistically would flash the modal at returning users.
  if (!isLoaded) return null;

  const showModal = !isSignedIn && splashDone;

  return (
    <>
      <div inert={showModal} aria-hidden={showModal}>
        {children}
      </div>
      {showModal && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to AppBlips"
        >
          <SignIn routing="hash" />
        </div>
      )}
    </>
  );
}
