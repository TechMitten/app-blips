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
  sendPasswordResetEmail,
  updatePassword as firebaseUpdatePassword,
  updateProfile as firebaseUpdateProfile,
  deleteUser,
} from 'firebase/auth';
import { getToken } from 'firebase/app-check';

// Guarded Firebase provider: every function here assumes firebaseEnabled is
// true (auth/appCheck from ../../firebase are non-null) -- this module is
// only ever selected by ./index.js when that's the case, so none of these
// Firebase SDK calls run in a self-hosted build.

const toUser = (firebaseUser) => {
  if (!firebaseUser) return null;
  const username = firebaseUser.displayName || '';
  return Object.assign({}, firebaseUser, {
    id: firebaseUser.uid,
    displayName: username,
    username,
    user_metadata: {
      ...firebaseUser.user_metadata,
      username,
    },
  });
};

const listeners = new Set();

const notifyListeners = (user) => {
  listeners.forEach((callback) => {
    try {
      callback(user);
    } catch (e) {
      console.error('Error in auth listener:', e);
    }
  });
};

const onAuthStateChanged = (callback) => {
  listeners.add(callback);
  const unsubscribe = firebaseOnAuthStateChanged(auth, (firebaseUser) => {
    callback(toUser(firebaseUser));
  });

  return () => {
    listeners.delete(callback);
    unsubscribe();
  };
};

const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);

const signUp = async (email, password) => {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
};

const sendPasswordReset = (email) => sendPasswordResetEmail(auth, email);

const signInWithGithub = () => {
  const provider = new GithubAuthProvider();
  // Without user:email, users with a private GitHub email get no email on their Firebase account.
  provider.addScope('user:email');
  return signInWithPopup(auth, provider);
};

const signInWithGoogle = () => {
  const provider = new GoogleAuthProvider();
  // Request explicitly so the account always gets an email (shown as the Identifier in the console).
  provider.addScope('email');
  provider.addScope('profile');
  return signInWithPopup(auth, provider);
};

const signOut = () => firebaseSignOut(auth);

const updatePassword = (newPassword) => firebaseUpdatePassword(auth.currentUser, newPassword);

const updateProfile = async (profile) => {
  await firebaseUpdateProfile(auth.currentUser, profile);
  notifyListeners(toUser(auth.currentUser));
};

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
  sendPasswordReset,
  signInWithGithub,
  signInWithGoogle,
  signOut,
  updatePassword,
  updateProfile,
  deleteAccount,
  getIdToken,
  getAppCheckToken,
};
