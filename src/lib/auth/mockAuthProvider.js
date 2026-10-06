// Local provider for single-user builds (no Firebase configured, the default,
// and always on desktop): a single fixed user, always signed in, no real
// backend behind it. Auth UI never renders in this mode (see Header.jsx/App.jsx),
// so signInWithOAuth/etc. are unreachable in practice -- they're no-ops here
// only for safety.

const currentMockUser = {
  id: 'local-user',
  uid: 'local-user',
  email: 'local@localhost',
  displayName: 'Local User',
  username: 'Local User',
};

const onAuthStateChanged = (callback) => {
  let active = true;
  Promise.resolve().then(() => { if (active) callback(currentMockUser); });
  return () => { active = false; };
};

const noop = async () => {};

export default {
  onAuthStateChanged,
  signInWithOAuth: noop,
  signOut: noop,
  deleteAccount: noop,
  getPrimaryProviderId: () => null,
  reauthenticate: noop,
  getIdToken: async () => 'local-mode',
};
