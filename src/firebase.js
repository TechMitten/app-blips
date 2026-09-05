import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBcnXgBSRWClM_ghSuOqyayayFRn4ksKvM",
  authDomain: "appbips-f46e2.firebaseapp.com",
  projectId: "appbips-f46e2",
  storageBucket: "appbips-f46e2.firebasestorage.app",
  messagingSenderId: "472626328876",
  appId: "1:472626328876:web:2800d30e2a40acfbf26889",
  measurementId: "G-Q0SKEZX67P"
};

export const app = initializeApp(firebaseConfig);

if (typeof self !== 'undefined' && import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6Lde6qotAAAAAOCm2EAdgRuVZo8__6WrZW-0wFDM'),
  isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
