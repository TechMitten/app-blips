import { useState, useEffect, useRef, useCallback } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, writeBatch } from 'firebase/firestore';
import { readProjectRows } from '../lib/projectsStorage';

// One-time local -> cloud project import flag, keyed per user.
const importFlagKey = (userId) => `orion-imported-${userId}`;

// Session lifecycle for Supabase auth: restores the session on mount, keeps it
// in sync, and owns the one-time local -> cloud import offer. The auth modal's
// form state lives in <AuthModal> (self-contained, like AccountSettingsModal).
export default function useAuth() {
  const [session, setSession] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'signedOut' | 'signedIn'
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importLocalCount, setImportLocalCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  // Transient 'signedIn' | 'signedOut' notification (null when hidden).
  const [authToast, setAuthToast] = useState(null);
  const prevAuthStatusRef = useRef(null);

  const isSignedIn = authStatus === 'signedIn';
  const user = session?.user ?? null;

  // --- Auth bootstrap: restore the session then keep it in sync ---
  useEffect(() => {
    let active = true;
    let unsubscribe = null;
    
    unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!active) return;
      setSession(firebaseUser ? { user: Object.assign({}, firebaseUser, { id: firebaseUser.uid }) } : null);
      setAuthStatus(firebaseUser ? 'signedIn' : 'signedOut');
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // --- One-time local → cloud project import (offered after first sign-in) ---
  const maybeOfferImport = useCallback(() => {
    if (!user?.id) return;
    try {
      if (localStorage.getItem(importFlagKey(user.id))) return;
    } catch { /* storage unavailable */ }
    const localRows = readProjectRows();
    if (!localRows.length) return;
    setImportLocalCount(localRows.length);
    setIsImportModalOpen(true);
  }, [user?.id]);

  // Close the auth modal the moment a session lands; offer a one-time local
  // project import right after signing in.
  useEffect(() => {
    if (authStatus === 'signedIn') {
      setIsAuthModalOpen(false);
      maybeOfferImport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Pop the "signed in/out" toast on real transitions only — the initial
  // session restore ('loading' -> signedIn/signedOut) is silent.
  useEffect(() => {
    const prev = prevAuthStatusRef.current;
    prevAuthStatusRef.current = authStatus;
    if (prev === 'signedOut' && authStatus === 'signedIn') setAuthToast('signedIn');
    if (prev === 'signedIn' && authStatus === 'signedOut') setAuthToast('signedOut');
  }, [authStatus]);

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!authToast) return;
    const timer = setTimeout(() => setAuthToast(null), 4000);
    return () => clearTimeout(timer);
  }, [authToast]);

  // `reloadProjects` is passed in by the caller (the projects hook owns the list).
  const handleImportProjects = useCallback(async (reloadProjects) => {
    if (!user?.id) return;
    setIsImporting(true);
    try {
      const localRows = readProjectRows();
      const rows = localRows.map((r) => ({
        id: crypto.randomUUID(),
        user_id: user.id,
        name: r.name || 'Untitled App',
        data: r.data || { versions: [], currentVersionIndex: -1 },
        updated_at: r.updatedAt || new Date().toISOString()
      }));
      if (rows.length) {
        const batch = writeBatch(db);
        rows.forEach(r => {
          const docRef = doc(db, 'projects', r.id);
          batch.set(docRef, r);
        });
        await batch.commit();
      }
      localStorage.setItem(importFlagKey(user.id), '1');
      setIsImportModalOpen(false);
      setImportLocalCount(0);
      await reloadProjects();
    } catch (err) {
      console.error('Error importing projects:', err);
    } finally {
      setIsImporting(false);
    }
  }, [user?.id]);

  const handleSkipImport = useCallback(() => {
    if (user?.id) {
      try { localStorage.setItem(importFlagKey(user.id), '1'); } catch { /* ignore */ }
    }
    setIsImportModalOpen(false);
    setImportLocalCount(0);
  }, [user?.id]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  return {
    authStatus,
    isSignedIn,
    user,
    authToast,
    dismissAuthToast: () => setAuthToast(null),
    isAuthModalOpen,
    setIsAuthModalOpen,
    isImportModalOpen,
    importLocalCount,
    isImporting,
    handleImportProjects,
    handleSkipImport,
    handleSignOut,
  };
}
