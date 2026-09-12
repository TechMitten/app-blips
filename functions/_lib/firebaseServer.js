// Shared server-side Firebase identity for app serving and AI validation.
const FIREBASE_PROJECT_ID = 'appbips-f46e2';
const FIREBASE_APP_ID = '1:472626328876:web:2800d30e2a40acfbf26889';
const FIREBASE_API_KEY = 'AIzaSyBcnXgBSRWClM_ghSuOqyayayFRn4ksKvM';
const FIREBASE_APPCHECK_DEBUG_TOKEN = 'a96e675f-24b0-444f-9cff-ea0075345af1';

export const firebaseProjectId = (env = {}) => env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;

let cachedAppCheckToken = null;
let tokenExpiry = 0;
let cachedConfig = null;

export const getAppCheckToken = async (env) => {
  const now = Date.now();
  const projectId = env?.FIREBASE_PROJECT_ID || env?.VITE_FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  const appId = env?.FIREBASE_APP_ID || env?.VITE_FIREBASE_APP_ID || FIREBASE_APP_ID;
  const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || FIREBASE_API_KEY;
  const debugToken =
    env?.FIREBASE_APPCHECK_DEBUG_TOKEN ||
    env?.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN ||
    FIREBASE_APPCHECK_DEBUG_TOKEN;

  if (!debugToken) return null;
  const config = JSON.stringify([projectId, appId, apiKey, debugToken]);
  if (cachedConfig === config && cachedAppCheckToken && now < tokenExpiry) {
    return cachedAppCheckToken;
  }

  try {
    const res = await fetch(
      `https://firebaseappcheck.googleapis.com/v1/projects/${projectId}/apps/${appId}:exchangeDebugToken?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ debugToken }),
      }
    );
    if (!res.ok) {
      console.warn('Failed to exchange App Check debug token:', res.status);
      return null;
    }
    const data = await res.json();
    if (data.token) {
      cachedConfig = config;
      cachedAppCheckToken = data.token;
      const ttlSeconds = parseInt(data.ttl, 10) || 3600;
      tokenExpiry = now + (ttlSeconds - 60) * 1000;
      return cachedAppCheckToken;
    }
  } catch (err) {
    console.warn('Error obtaining App Check token:', err);
  }
  return null;
};
