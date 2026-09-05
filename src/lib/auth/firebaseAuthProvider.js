import { auth, appCheck } from '../../firebase';
import {
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GithubAuthProvider,
  GoogleAuthProvider,
  sendEmailVerification,
  updatePassword as firebaseUpdatePassword,
  updateProfile as firebaseUpdateProfile,
  deleteUser,
} from 'firebase/auth';
import { getToken } from 'firebase/app-check';

// Guarded Firebase provider: every function here assumes firebaseEnabled is
// true (auth/appCheck from ../../firebase are non-null) -- this module is
// only ever selected by ./index.js when that's the case, so none of these
// Firebase SDK calls run in a self-hosted build.

const toUser = (firebaseUser) =>
  firebaseUser ? Object.assign({}, firebaseUser, { id: firebaseUser.uid }) : null;

const onAuthStateChanged = (callback) =>
  firebaseOnAuthStateChanged(auth, (firebaseUser) => callback(toUser(firebaseUser)));

const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);

const signUp = async (email, password) => {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
};

const signInWithGithub = () => signInWithPopup(auth, new GithubAuthProvider());

const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());

const signOut = () => firebaseSignOut(auth);

const updatePassword = (newPassword) => firebaseUpdatePassword(auth.currentUser, newPassword);

const updateProfile = (profile) => firebaseUpdateProfile(auth.currentUser, profile);

const deleteAccount = () => deleteUser(auth.currentUser);

const getIdToken = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required.');
  return user.getIdToken();
};

const getAppCheckToken = async () => {
  if (!appCheck) return null;
  try {
    const result = await getToken(appCheck, false);
    return result.token;
  } catch (e) {
    console.warn('Failed to get App Check token:', e);
    return null;
  }
};

export default {
  onAuthStateChanged,
  signIn,
  signUp,
  signInWithGithub,
  signInWithGoogle,
  signOut,
  updatePassword,
  updateProfile,
  deleteAccount,
  getIdToken,
  getAppCheckToken,
};
