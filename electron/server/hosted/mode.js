// Hosted (multi-user) mode is on exactly when the server has what it needs to
// run it: a Clerk publishable key to verify sign-ins and a Creem API key for
// the selected Creem server (CREEM_SERVER, test unless 'prod'). There is no
// separate on/off switch. Without both, the server stays single-user: no
// sign-in, and people use their own AI key.
//
// No imports on purpose: chatProxy.js uses this and must stay free of
// Node-only APIs (it also runs in the Android WebView).

export function isHosted(env) {
  const clerkKey = String(env?.VITE_CLERK_PUBLISHABLE_KEY || env?.CLERK_PUBLISHABLE_KEY || '').trim();
  const prod = String(env?.CREEM_SERVER || 'test').toLowerCase() === 'prod';
  const creemKey = String((prod ? env?.CREEM_API_KEY : env?.CREEM_TEST_API_KEY) || '').trim();
  return /^pk_(?:test|live)_./.test(clerkKey) && Boolean(creemKey);
}
