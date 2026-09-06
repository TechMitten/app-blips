// Shared shape both providers (firebaseAuthProvider, mockAuthProvider)
// implement, so useAuth/AuthModal/AccountSettingsModal/llm.js can stay
// unaware of which one is active. Selection happens in ./index.js, based on
// firebaseEnabled (src/firebase.js, driven by SELF_HOSTED_MODE).
//
// User shape: { id, email, displayName } | null
//
// authProvider.onAuthStateChanged(callback) -> unsubscribe
// authProvider.signIn(email, password) -> Promise<void>
// authProvider.signUp(email, password) -> Promise<void>
// authProvider.signInWithGithub() -> Promise<void>
// authProvider.signInWithGoogle() -> Promise<void>
// authProvider.signOut() -> Promise<void>
// authProvider.updatePassword(newPassword) -> Promise<void>
// authProvider.updateProfile({ displayName }) -> Promise<void>
// authProvider.deleteAccount() -> Promise<void>
// authProvider.getIdToken() -> Promise<string>
// authProvider.getAppCheckToken() -> Promise<string|null>
