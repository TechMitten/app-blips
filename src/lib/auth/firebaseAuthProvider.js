import {
  GoogleAuthProvider, GithubAuthProvider, signInWithPopup, reauthenticateWithPopup,
  onAuthStateChanged as onFirebaseAuthStateChanged, signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../../firebase';

// Sign-in is Google or GitHub only, in a popup (works the same on every
// browser without the cross-site storage that redirect sign-in needs when the
// auth domain differs from the app's).
// A sign-in this close to the account's creation is the sign-up itself.
const NEW_ACCOUNT_WINDOW_MS = 60 * 1000;

const toUser = (user) => user ? {
  id: user.uid,
  uid: user.uid,
  email: user.email || '',
  displayName: user.displayName || '',
  username: '',
  // True while the session is the one that created the account: Firebase
  // only moves lastSignInTime on a later sign-in, not on a restored session.
  isNewAccount: Math.abs(Date.parse(user.metadata?.lastSignInTime) - Date.parse(user.metadata?.creationTime)) < NEW_ACCOUNT_WINDOW_MS,
} : null;

const makeProvider = (id) => {
  if (id === 'google') {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  }
  if (id === 'github') {
    const provider = new GithubAuthProvider();
    provider.addScope('user:email');
    return provider;
  }
  throw new Error('Unsupported sign-in provider.');
};

const PROVIDER_IDS = { 'google.com': 'google', 'github.com': 'github' };

// Sign-ups switched off in Firebase (Authentication -> Settings -> User
// actions -> "Enable create"), as during maintenance: a new Google/GitHub
// user is refused, existing accounts still sign in.
const SIGNUPS_CLOSED_MESSAGE = 'New sign-ups are paused right now. If you already have an account, sign in with the same Google or GitHub account you used before.';

const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

const friendlyError = (err) => {
  switch (err?.code) {
    case 'auth/admin-restricted-operation':
      return SIGNUPS_CLOSED_MESSAGE;
    case 'auth/account-exists-with-different-credential':
      return 'An AppBlips account already uses this email. Sign in with the provider you used before (Google or GitHub).';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection and try again.';
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
      return 'Sign-in is not set up for this site yet.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/requires-recent-login':
    case 'auth/user-mismatch':
      return 'Please sign in with the same account to continue.';
    default:
      return 'Sign-in failed. Please try again.';
  }
};

const onAuthStateChanged = (callback) =>
  onFirebaseAuthStateChanged(auth, (user) => callback(toUser(user)));

// Resolves once signed in, or quietly when the user closes the popup.
const signInWithOAuth = async (providerId) => {
  try {
    await signInWithPopup(auth, makeProvider(providerId));
  } catch (err) {
    if (CANCELLED.has(err?.code)) return;
    console.error('Sign-in failed:', err);
    throw new Error(friendlyError(err));
  }
};

const signOut = () => firebaseSignOut(auth);

// The provider the account signs in with ('google' | 'github'), or null.
const getPrimaryProviderId = () => {
  const providerId = auth.currentUser?.providerData?.[0]?.providerId;
  return PROVIDER_IDS[providerId] || null;
};

// Proves it's still the account owner right before something destructive:
// a fresh provider sign-in, which also gives the ID token a recent auth_time
// (the server's account deletion requires one).
const reauthenticate = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required.');
  try {
    await reauthenticateWithPopup(user, makeProvider(getPrimaryProviderId() || 'google'));
  } catch (err) {
    if (CANCELLED.has(err?.code)) {
      const cancelled = new Error('Verification was cancelled.');
      cancelled.code = err.code;
      throw cancelled;
    }
    throw new Error(friendlyError(err));
  }
};

const getIdToken = async (forceRefresh = false) => {
  if (!auth.currentUser) throw new Error('Sign in required.');
  return auth.currentUser.getIdToken(forceRefresh);
};

// Deletion happens server-side (functions/_lib/account.js), so the account's
// projects, published apps, usage and subscription all go with it.
const deleteAccount = async () => {
  const res = await fetch('/api/account/delete', {
    method: 'POST',
    headers: { authorization: `Bearer ${await getIdToken(true)}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not delete your account.');
  await firebaseSignOut(auth).catch(() => {});
};

export default {
  onAuthStateChanged, signInWithOAuth, signOut, deleteAccount, reauthenticate, getIdToken, getPrimaryProviderId,
};
