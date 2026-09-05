import { useState } from 'react';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GithubAuthProvider, GoogleAuthProvider, sendEmailVerification } from 'firebase/auth';
import { User, Mail, X, Loader2, Eye, EyeOff, Github } from 'lucide-react';
import Modal from './Modal';

// Self-contained sign-in / sign-up modal (same pattern as
// AccountSettingsModal): owns its form state and talks to Supabase directly.
// onAuthStateChange in useAuth closes the modal the moment a session lands.
export default function AuthModal({ onClose = () => {}, dismissible = true }) {
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authInfo, setAuthInfo] = useState(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const handleAuthModeSwitch = (mode) => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthInfo(null);
  };

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthError('Enter your email and password.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);

    try {
      if (authMode === 'signup') {
        const userCredential = await createUserWithEmailAndPassword(auth, email, authPassword);
        // Supabase behavior was to send confirmation link. We can do the same:
        await sendEmailVerification(userCredential.user);
        setAuthInfo('We sent a confirmation link to your email. Confirm your account, then sign in.');
        // Note: Firebase signs the user in immediately upon creation, 
        // so the session will land and onAuthStateChange will close the modal.
      } else {
        await signInWithEmailAndPassword(auth, email, authPassword);
        // onAuthStateChange closes the modal on success.
      }
    } catch (err) {
      setAuthError(err?.message || 'Authentication failed.');
      setAuthInfo(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setAuthError(null);
    setAuthInfo(null);
    setOauthLoading(true);
    try {
      const provider = new GithubAuthProvider();
      await signInWithPopup(auth, provider);
      // On success onAuthStateChange picks up the session and closes the modal.
    } catch (err) {
      setAuthError(err?.message || 'GitHub sign-in failed.');
      setOauthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthInfo(null);
    setOauthLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setAuthError(err?.message || 'Google sign-in failed.');
      setOauthLoading(false);
    }
  };

  return (
    <Modal zIndex={80}>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
            <User size={18} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            {authMode === 'signup' ? 'Create your account' : 'Welcome Back!'}
          </h2>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <form onSubmit={handleAuthSubmit} className="p-6 space-y-5">
        {authInfo && (
          <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 leading-relaxed flex items-start gap-3">
            <Mail size={18} className="text-green-500 shrink-0 mt-0.5" />
            <span>{authInfo}</span>
          </div>
        )}
        {authError && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 leading-relaxed">
            {authError}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleGithubSignIn}
            disabled={authLoading || oauthLoading}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-sm font-bold shadow-sm transition-colors active:scale-[0.98] ${
              oauthLoading
                ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                : 'bg-slate-900 text-white hover:bg-black'
            }`}
          >
            {oauthLoading ? <Loader2 className="animate-spin" size={18} /> : <Github size={18} />}
            GitHub
          </button>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={authLoading || oauthLoading}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3.5 text-sm font-bold shadow-sm transition-colors active:scale-[0.98] border border-slate-200 ${
              oauthLoading
                ? 'bg-slate-50 text-slate-400 cursor-not-allowed'
                : 'bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {oauthLoading ? <Loader2 className="animate-spin" size={18} /> : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            Google
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
          <div className="h-px flex-1 bg-slate-100" />
          or
          <div className="h-px flex-1 bg-slate-100" />
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Email</label>
            <input
              autoFocus
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Password</label>
            <div className="relative">
              <input
                type={showAuthPassword ? 'text' : 'password'}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 pr-10 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowAuthPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-800 transition-colors"
                aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
              >
                {showAuthPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
        </div>

        {authMode === 'signup' ? (
          <p className="text-xs text-slate-400 leading-relaxed">
            Your generated apps and version history sync to your account and are only visible to you.
          </p>
        ) : (
          <p className="text-xs text-slate-400 leading-relaxed">
            Sign in to start creating apps with AppBlips.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={authLoading || oauthLoading}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors active:scale-[0.98] ${
              authLoading
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-sm'
            }`}
          >
            {authLoading && <Loader2 className="animate-spin" size={15} />}
            {authMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>

      <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 text-center text-sm">
        {authMode === 'signup' ? (
          <>Already have an account?{' '}
            <button
              type="button"
              onClick={() => handleAuthModeSwitch('signin')}
              className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Sign in
            </button>
          </>
        ) : (
          <>New to AppBlips?{' '}
            <button
              type="button"
              onClick={() => handleAuthModeSwitch('signup')}
              className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Create an account
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
