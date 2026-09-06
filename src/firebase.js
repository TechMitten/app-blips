import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Self-hosted builds run with no Firebase project at all: every VITE_FIREBASE_*
// var (and the SDK init below, including the network call initializeAppCheck
// makes to Google's reCAPTCHA endpoint) is skipped entirely unless
// SELF_HOSTED_MODE=false. Self-hosted is the default when unset. See
// src/lib/auth/ for the adapter that picks a real vs. mock auth provider
// based on this same flag, and functions/_lib/chatProxy.js for the
// server-side half (SELF_HOSTED_MODE has no VITE_ prefix but is allow-listed
// into the client bundle too, via vite.config.js's envPrefix, so this one var
// drives both runtimes).
export const firebaseEnabled = import.meta.env.SELF_HOSTED_MODE === 'false';

let app = null;
let appCheck = null;
let auth = null;
let db = null;
let storage = null;

if (firebaseEnabled) {
  const required = {
    apiKey: 'VITE_FIREBASE_API_KEY',
    authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
    projectId: 'VITE_FIREBASE_PROJECT_ID',
    storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
    appId: 'VITE_FIREBASE_APP_ID',
  };

  const firebaseConfig = {};
  const missing = [];
  for (const [configKey, envName] of Object.entries(required)) {
    const value = import.meta.env[envName];
    if (!value) missing.push(envName);
    firebaseConfig[configKey] = value;
  }
  if (missing.length) {
    throw new Error(`SELF_HOSTED_MODE is false but missing required env vars: ${missing.join(', ')}`);
  }

  app = initializeApp(firebaseConfig);

  if (typeof self !== 'undefined' && import.meta.env.DEV) {
    const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
  }

  const recaptchaSiteKey = import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY;
  if (recaptchaSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  }

  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

export { app, appCheck, auth, db, storage };
