// Local provider for self-hosted builds (VITE_USE_FIREBASE=false): a single
// fixed user, always signed in, no real backend behind it. Auth UI never
// renders in this mode (see Header.jsx/App.jsx), so signIn/signUp/etc. are
// unreachable in practice -- they're no-ops here only for safety.

const MOCK_USER = { id: 'local-user', email: 'local@localhost', displayName: 'Local User' };

const onAuthStateChanged = (callback) => {
  Promise.resolve().then(() => callback(MOCK_USER));
  return () => {};
};

const noop = async () => {};

export default {
  onAuthStateChanged,
  signIn: noop,
  signUp: noop,
  signInWithGithub: noop,
  signInWithGoogle: noop,
  signOut: noop,
  updatePassword: noop,
  updateProfile: noop,
  deleteAccount: noop,
  getIdToken: async () => 'local-mode',
  getAppCheckToken: async () => null,
};
