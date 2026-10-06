import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { isDesktop } from './lib/desktop';

// Multi-user features (sign-in, cloud projects, deploys, billing) turn on
// when the operator configures a Firebase project. These values are the
// public web-app config; what protects data is firestore.rules plus the
// server-side checks in functions/_lib, not keeping them secret.
//
// The desktop app is always single-user (local projects, the user's own
// provider key), whatever the build env says.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = !isDesktop && Object.values(config).every(Boolean);

let auth = null;
let db = null;

if (firebaseEnabled) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { auth, db };
