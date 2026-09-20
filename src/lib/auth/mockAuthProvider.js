// Local provider for self-hosted builds (SELF_HOSTED_MODE=true, the default): a single
// fixed user, always signed in, no real backend behind it. Auth UI never
// renders in this mode (see Header.jsx/App.jsx), so signIn/signUp/etc. are
// unreachable in practice -- they're no-ops here only for safety.

let currentMockUser = {
  id: 'local-user',
  uid: 'local-user',
  email: 'local@localhost',
  displayName: 'Local User',
  username: 'Local User',
  user_metadata: { username: 'Local User' },
};

const listeners = new Set();

const onAuthStateChanged = (callback) => {
  listeners.add(callback);
  Promise.resolve().then(() => callback(currentMockUser));
  return () => {
    listeners.delete(callback);
  };
};

const noop = async () => {};

const updateProfile = async (profile) => {
  const displayName = profile?.displayName || currentMockUser.displayName;
  currentMockUser = {
    ...currentMockUser,
    ...profile,
    displayName,
    username: displayName,
    user_metadata: {
      ...currentMockUser.user_metadata,
      username: displayName,
    },
  };
  listeners.forEach((callback) => callback(currentMockUser));
};

export default {
  onAuthStateChanged,
  signIn: noop,
  signUp: noop,
  sendPasswordReset: noop,
  signInWithGithub: noop,
  signInWithGoogle: noop,
  signOut: noop,
  updatePassword: noop,
  updateProfile,
  deleteAccount: noop,
  getPrimaryProviderId: () => null,
  reauthenticate: noop,
  getIdToken: async () => 'local-mode',
  getAppCheckToken: async () => null,
};
