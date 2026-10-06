import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Deploy slugs are `username/app-slug` and functions/_lib/deploys.js's
// SLUG_PATTERN caps the first segment at 39 chars of [a-z0-9-], so this stays
// in lockstep with that (and with firestore.rules).
export const USERNAME_REGEX = /^[a-z0-9-]{3,39}$/;

export const normalizeUsername = (raw) => (raw || '').trim().toLowerCase();

export const USERNAME_FORMAT_HINT =
  'Username must be 3-39 characters and can only contain lowercase letters, numbers, and hyphens.';

export const fetchUsername = async (uid) => {
  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists() ? snapshot.data().username || '' : '';
};

// Reserves `usernames/{username}` and stamps it onto `users/{uid}` in one
// batch. firestore.rules only allow the pair together, refuse a name someone
// already holds (a write to an existing doc is an update, which is never
// allowed), and refuse changing a username once set -- so a successful claim
// is permanent, and stays reserved even after the account is deleted.
export const claimUsername = async (uid, rawUsername) => {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error('Username cannot be empty.');
  if (!USERNAME_REGEX.test(username)) throw new Error(USERNAME_FORMAT_HINT);
  if (await fetchUsername(uid)) throw new Error('Your username is already set.');

  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', username), { uid, created_at: serverTimestamp() });
  batch.set(doc(db, 'users', uid), { username, updated_at: serverTimestamp() });
  try {
    await batch.commit();
  } catch (err) {
    if (err?.code === 'permission-denied') throw new Error('That username is already taken.');
    throw err;
  }
  return username;
};
