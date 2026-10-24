// Client-side helper for /api/credits (electron/server/creditsApi.js).
// Works identically across Electron desktop, server.js, Vite dev server,
// and Android. The user's credit token stays server-side (OS keychain on
// desktop, keyFile.js in browser mode); the renderer only sees the email
// and remaining credit balance.

import { CREDIT_PACKS, FREE_TRIAL_PACK } from '../../electron/server/creditsApi.js';

export { CREDIT_PACKS, FREE_TRIAL_PACK };

async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'Couldn’t reach the AppBlips Credits service. Check your internet connection and try again.' };
  }
  try {
    return await response.json();
  } catch {
    return { error: `AppBlips Credits request failed (HTTP ${response.status}).` };
  }
}

export const creditsStatus = () => call('/api/credits');
export const creditsConnect = (email) => call('/api/credits/connect', { method: 'POST', body: { email } });
export const creditsCheckout = (packId, email = '') => call('/api/credits/checkout', { method: 'POST', body: { packId, email } });
export const creditsSignOut = () => call('/api/credits', { method: 'DELETE' });
