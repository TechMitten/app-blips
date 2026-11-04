// How the renderer hands the current Clerk session to non-React modules.
// App components install the getter; the chat transport and billing helpers
// call it. In local/desktop use there is no Clerk session and it returns null.

let getter = null;

export function setAuthTokenGetter(fn) {
  getter = typeof fn === 'function' ? fn : null;
}

export async function getAuthToken() {
  if (!getter) return null;
  try {
    return (await getter()) || null;
  } catch {
    return null;
  }
}
