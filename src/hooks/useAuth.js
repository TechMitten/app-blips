import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase';
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

  const isSignedIn = authStatus === 'signedIn';
  const user = session?.user ?? null;

  // --- Auth bootstrap: restore the session then keep it in sync ---
  useEffect(() => {
    let active = true;
    let unsubscribe = null;

    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => {
        if (!active) return;
        setSession(initialSession);
        setAuthStatus(initialSession ? 'signedIn' : 'signedOut');
      })
      .catch((err) => {
        console.error('[Orion] Failed to restore Supabase session:', err);
        if (active) {
          setSession(null);
          setAuthStatus('signedOut');
        }
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthStatus(nextSession ? 'signedIn' : 'signedOut');
    });

    unsubscribe = () => subscription.unsubscribe();
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
        const { error } = await supabase.from('projects').insert(rows);
        if (error) throw error;
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
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  return {
    authStatus,
    isSignedIn,
    user,
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
