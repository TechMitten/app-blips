// Shared shape both providers (supabaseAuthProvider, mockAuthProvider)
// implement, so useAuth/AuthModal/AccountSettingsModal/llm.js can stay
// unaware of which one is active. Selection happens in ./index.js, based on
// supabaseEnabled (see ../supabase.js, driven by Supabase config).
//
// User shape: { id, email, displayName, username, user_metadata: { username } } | null
//
// authProvider.onAuthStateChanged(callback) -> unsubscribe
// authProvider.signIn(email, password, captchaToken) -> Promise<void>
// authProvider.signUp(email, password, captchaToken) -> Promise<void>
// authProvider.sendPasswordReset(email, captchaToken) -> Promise<void>
// authProvider.signOut() -> Promise<void>
// authProvider.updatePassword(newPassword) -> Promise<void>
// authProvider.updateProfile({ displayName }) -> Promise<void>
// authProvider.deleteAccount() -> Promise<void>
// authProvider.getIdToken() -> Promise<string>
