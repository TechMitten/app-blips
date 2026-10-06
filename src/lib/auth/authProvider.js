// Shared shape both providers (firebaseAuthProvider, mockAuthProvider)
// implement, so useAuth/AuthModal/SettingsModal/llm.js can stay unaware of
// which one is active. Selection happens in ./index.js, based on
// firebaseEnabled (see ../../firebase.js, driven by the Firebase config).
//
// User shape: { id, uid, email, displayName, username } | null
//
// authProvider.onAuthStateChanged(callback(user)) -> unsubscribe
// authProvider.signInWithOAuth('google' | 'github') -> Promise<void>
//   (resolves once signed in, or quietly if the user closes the popup)
// authProvider.signOut() -> Promise<void>
// authProvider.reauthenticate() -> Promise<void> (fresh provider sign-in before deletion)
// authProvider.deleteAccount() -> Promise<void>
// authProvider.getPrimaryProviderId() -> 'google' | 'github' | null
// authProvider.getIdToken() -> Promise<string>
