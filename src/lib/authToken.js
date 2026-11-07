// How the renderer hands the current Clerk session to non-React modules.
// App components install the getter; the chat transport and billing helpers
// call it. In local/desktop use there is no Clerk session and it returns null.

let getter = null;

export function setAuthTokenGetter(fn) {
  getter = typeof fn === 'function' ? fn : null;
}

// Factory Reset signs out of the AppBlips account the same way: AuthSession
// installs Clerk's signOut, and copies without accounts have none.
let signOutFn = null;

export function setAccountSignOut(fn) {
  signOutFn = typeof fn === 'function' ? fn : null;
}

// Resolves once signed out (or when there's no account to sign out of);
// throws if Clerk couldn't end the session (offline, for example).
export async function signOutAccount() {
  if (signOutFn) await signOutFn();
}

export async function getAuthToken() {
  if (!getter) return null;
  try {
    return (await getter()) || null;
  } catch {
    return null;
  }
}
