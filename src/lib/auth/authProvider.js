// Shared shape both providers (supabaseAuthProvider, mockAuthProvider)
// implement, so useAuth/AuthModal/AccountSettingsModal/llm.js can stay
// unaware of which one is active. Selection happens in ./index.js, based on
// supabaseEnabled (see ../supabase.js, driven by Supabase config).
//
// User shape: { id, email, displayName, username, user_metadata: { username } } | null
//
// authProvider.onAuthStateChanged(callback(user, event)) -> unsubscribe
//   event is the provider's auth event ('PASSWORD_RECOVERY' after a reset link), when it has one
// authProvider.consumeEmailLink() -> Promise<'email' | 'recovery' | ... | null> (rejects on a bad/expired link)
// authProvider.signIn(email, password) -> Promise<void>
// authProvider.signInWithOAuth('google' | 'github') -> Promise<void>
//   (web: redirects away and resolves never; desktop: resolves once signed in)
// authProvider.cancelOAuth() -> void (stops a desktop browser sign-in that is waiting)
// authProvider.sendPasswordReset(email) -> Promise<void>
// authProvider.signOut() -> Promise<void>
// authProvider.updatePassword(newPassword) -> Promise<void>
// authProvider.updateProfile({ displayName }) -> Promise<void>
// authProvider.deleteAccount() -> Promise<void>
// authProvider.getIdToken() -> Promise<string>
