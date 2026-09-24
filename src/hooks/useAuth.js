import { useState, useEffect, useRef, useCallback } from 'react';
import authProvider, { firebaseEnabled } from '../lib/auth';
import { markHasSignedIn } from '../lib/config';
import { fetchUsername, claimUsername as claimUsernameForUid } from '../lib/username';

// Session lifecycle, driven by the auth adapter (Firebase or the self-hosted
// mock, see src/lib/auth): restores the session on mount and keeps it in
// sync. The auth modal's form state lives in <AuthModal> (self-contained,
// like AccountSettingsModal).
export default function useAuth() {
  const [session, setSession] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'signedOut' | 'signedIn'
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  // Transient 'signedIn' | 'signedOut' notification (null when hidden).
  const [authToast, setAuthToast] = useState(null);
  const prevAuthStatusRef = useRef(null);
  // Permanent per-user handle, stored in Firestore (users/{uid}.username) --
  // see src/lib/username.js. Not part of the Firebase Auth user object.
  const [username, setUsername] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);

  const isSignedIn = authStatus === 'signedIn';
  const user = session?.user ?? null;

  // --- Auth bootstrap: restore the session then keep it in sync ---
  useEffect(() => {
    let active = true;
    let unsubscribe = null;
    
    unsubscribe = authProvider.onAuthStateChanged((user) => {
      if (!active) return;
      setSession(user ? { user } : null);
      setAuthStatus(user ? 'signedIn' : 'signedOut');
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // --- Load the permanent username once per signed-in user ---
  useEffect(() => {
    if (!firebaseEnabled || !user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsername('');
      return;
    }
    let active = true;
    setUsernameLoading(true);
    fetchUsername(user.id)
      .then((name) => { if (active) setUsername(name); })
      .catch((err) => console.error('Failed to load username:', err))
      .finally(() => { if (active) setUsernameLoading(false); });
    return () => { active = false; };
  }, [user]);

  const claimUsername = useCallback(async (rawUsername) => {
    if (!user?.id) throw new Error('Sign in required.');
    const claimed = await claimUsernameForUid(user.id, rawUsername);
    setUsername(claimed);
    return claimed;
  }, [user]);

  // Close the auth modal the moment a session lands.
  useEffect(() => {
    if (authStatus === 'signedIn') {
      if (firebaseEnabled) markHasSignedIn();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAuthModalOpen(false);
    }
  }, [authStatus]);

  // Pop the "signed in/out" toast on real transitions only — the initial
  // session restore ('loading' -> signedIn/signedOut) is silent.
  useEffect(() => {
    const prev = prevAuthStatusRef.current;
    prevAuthStatusRef.current = authStatus;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (prev === 'signedOut' && authStatus === 'signedIn') setAuthToast('signedIn');
    if (prev === 'signedIn' && authStatus === 'signedOut') setAuthToast('signedOut');
  }, [authStatus]);

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!authToast) return;
    const timer = setTimeout(() => setAuthToast(null), 4000);
    return () => clearTimeout(timer);
  }, [authToast]);

  const handleSignOut = async () => {
    try {
      await authProvider.signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  return {
    authStatus,
    isSignedIn,
    user,
    username,
    usernameLoading,
    claimUsername,
    authToast,
    dismissAuthToast: () => setAuthToast(null),
    isAuthModalOpen,
    setIsAuthModalOpen,
    handleSignOut,
  };
}
