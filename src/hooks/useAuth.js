import { useState, useEffect, useRef, useCallback } from 'react';
import authProvider, { supabaseEnabled } from '../lib/auth';
import { markHasSignedIn, consumeOAuthReturn } from '../lib/config';
import { fetchUsername, claimUsername as claimUsernameForUid } from '../lib/username';

// Read once per page load, at module scope so StrictMode's double render
// can't consume it before the second pass sees it.
const returningFromOAuth = consumeOAuthReturn();
// A failed OAuth redirect reopens the auth modal with the reason.
const oauthRedirectError = authProvider.consumeOAuthError?.() || null;

// Session lifecycle, driven by the auth adapter (Supabase or the self-hosted
// mock, see src/lib/auth): restores the session on mount and keeps it in
// sync. The auth modal's form state lives in <AuthModal> (self-contained,
// like AccountSettingsModal).
export default function useAuth() {
  const [session, setSession] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'signedOut' | 'signedIn'
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(Boolean(oauthRedirectError));
  // Transient 'signedIn' | 'signedOut' notification (null when hidden).
  const [authToast, setAuthToast] = useState(null);
  const prevAuthStatusRef = useRef(null);
  // Permanent per-user handle, stored in the Supabase profiles table.
  const [username, setUsername] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  // Set after a password-reset link signs the user in, so the app can ask
  // for a new password; and when a confirm/reset email link or an OAuth
  // redirect fails.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [emailLinkError, setEmailLinkError] = useState(oauthRedirectError);
  const signedInRef = useRef(false);

  const isSignedIn = authStatus === 'signedIn';
  const user = session?.user ?? null;

  // --- Auth bootstrap: restore the session then keep it in sync ---
  useEffect(() => {
    let active = true;
    let unsubscribe = null;
    
    unsubscribe = authProvider.onAuthStateChanged((user, event) => {
      if (!active) return;
      signedInRef.current = Boolean(user);
      setSession(user ? { user } : null);
      setAuthStatus(user ? 'signedIn' : 'signedOut');
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
    });

    authProvider.consumeEmailLink()
      .then((type) => { if (active && type === 'recovery') setIsPasswordRecovery(true); })
      .catch((err) => {
        console.error('Email link verification failed:', err);
        if (!active) return;
        setEmailLinkError('That email link has expired or was already used. Sign in, or request a new link.');
        if (!signedInRef.current) setIsAuthModalOpen(true);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // --- Load the permanent username once per signed-in user ---
  useEffect(() => {
    if (!supabaseEnabled || !user?.id) {
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
      if (supabaseEnabled) markHasSignedIn();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAuthModalOpen(false);
    }
  }, [authStatus]);

  // Pop the "signed in/out" toast on real transitions only — the initial
  // session restore ('loading' -> signedIn/signedOut) is silent, except right
  // after an OAuth redirect, where that restore *is* the sign-in.
  useEffect(() => {
    const prev = prevAuthStatusRef.current;
    prevAuthStatusRef.current = authStatus;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if ((prev === 'signedOut' || (prev === 'loading' && returningFromOAuth)) && authStatus === 'signedIn') setAuthToast('signedIn');
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
    returningFromOAuth,
    authToast,
    dismissAuthToast: () => setAuthToast(null),
    isAuthModalOpen,
    setIsAuthModalOpen,
    isPasswordRecovery,
    endPasswordRecovery: () => setIsPasswordRecovery(false),
    emailLinkError,
    clearEmailLinkError: () => setEmailLinkError(null),
    handleSignOut,
  };
}
