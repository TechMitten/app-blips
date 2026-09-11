import { db } from '../firebase';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';

// Deploy slugs are `username/app-slug` and functions/[[path]].js's
// SLUG_PATTERN caps the first segment at 39 chars of [a-z0-9-], so this stays
// in lockstep with that.
export const USERNAME_REGEX = /^[a-z0-9-]{3,39}$/;

export const normalizeUsername = (raw) => (raw || '').trim().toLowerCase();

export const USERNAME_FORMAT_HINT =
  'Username must be 3-39 characters and can only contain lowercase letters, numbers, and hyphens.';

export const fetchUsername = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data()?.username || '') : '';
};

// Atomically reserves `usernames/{username}` and stamps it onto `users/{uid}`.
// Firestore rules deny any further write to either document once created, so
// a successful claim here is permanent -- see firestore.rules.
export const claimUsername = async (uid, rawUsername) => {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error('Username cannot be empty.');
  if (!USERNAME_REGEX.test(username)) throw new Error(USERNAME_FORMAT_HINT);

  const usernameRef = doc(db, 'usernames', username);
  const userRef = doc(db, 'users', uid);

  await runTransaction(db, async (tx) => {
    const usernameSnap = await tx.get(usernameRef);
    if (usernameSnap.exists()) throw new Error('That username is already taken.');

    const userSnap = await tx.get(userRef);
    if (userSnap.exists() && userSnap.data()?.username) {
      throw new Error('Your username is already set and cannot be changed.');
    }

    tx.set(usernameRef, { uid, createdAt: serverTimestamp() });
    tx.set(userRef, { username, updatedAt: serverTimestamp() }, { merge: true });
  });

  return username;
};
