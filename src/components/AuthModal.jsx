import { useState } from 'react';
import authProvider from '../lib/auth';
import { LogIn, UserPlus, KeyRound, Mail, Lock, X, Loader2, Eye, EyeOff, Github, CircleAlert, MailCheck } from 'lucide-react';
import Modal from './Modal';

const INPUT_CLASS = 'w-full h-11 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:bg-white focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none transition-all';
const LABEL_CLASS = 'block text-sm font-medium text-slate-700 mb-1.5';
const LINK_CLASS = 'font-semibold text-brand hover:underline underline-offset-2 transition-colors';
const GITHUB_CLASS = 'w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-transparent bg-slate-900 text-sm font-semibold text-white hover:bg-black dark:bg-white/10 dark:hover:bg-white/15 dark:border-white/15 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed';
const OAUTH_CLASS = 'w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed';

// Self-contained sign-in / sign-up modal (same pattern as
// AccountSettingsModal): owns its form state and talks to the auth adapter
// directly (only ever mounted when firebaseEnabled -- see App.jsx). The
// auth-state listener in useAuth closes the modal the moment a session lands.
export default function AuthModal({ onClose = () => {}, dismissible = true }) {
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
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
    const isReset = authMode === 'reset';
    if (!email || (!isReset && !authPassword)) {
      setAuthError(isReset ? 'Enter your email.' : 'Enter your email and password.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);

    try {
      if (authMode === 'reset') {
        await authProvider.sendPasswordReset(email);
        setAuthInfo('If an account exists for that email, we sent a password reset link. Check your inbox (and spam).');
      } else if (authMode === 'signup') {
        await authProvider.signUp(email, authPassword);
        setAuthInfo('We sent a confirmation link to your email. Confirm your account, then sign in.');
        // Note: Firebase signs the user in immediately upon creation,
        // so the session will land and onAuthStateChange will close the modal.
      } else {
        await authProvider.signIn(email, authPassword);
        // onAuthStateChange closes the modal on success.
      }
    } catch (err) {
      // Don't reveal whether an account exists for the address on reset.
      if (authMode === 'reset' && err?.code === 'auth/user-not-found') {
        setAuthInfo('If an account exists for that email, we sent a password reset link. Check your inbox (and spam).');
        return;
      }
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
      await authProvider.signInWithGithub();
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
      await authProvider.signInWithGoogle();
    } catch (err) {
      setAuthError(err?.message || 'Google sign-in failed.');
      setOauthLoading(false);
    }
  };

  const isSignup = authMode === 'signup';
  const isReset = authMode === 'reset';
  const busy = authLoading || oauthLoading;

  const title = isSignup ? 'Create your account' : isReset ? 'Reset your password' : 'Welcome back';
  const subtitle = isSignup
    ? 'Your apps and version history sync to your account and stay private to you.'
    : isReset
      ? "Enter your email and we'll send you a link to choose a new password."
      : 'Sign in to keep building with AppBlips.';
  const submitLabel = isSignup ? 'Create account' : isReset ? 'Send reset link' : 'Sign in';
  const loadingLabel = isSignup ? 'Creating account…' : isReset ? 'Sending…' : 'Signing in…';
  const HeaderIcon = isSignup ? UserPlus : isReset ? KeyRound : LogIn;

  return (
    <Modal zIndex={80}>
      <div className="px-6 pt-6 pb-2 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
            <HeaderIcon size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
            <p className="mt-0.5 text-sm text-slate-500 leading-snug">{subtitle}</p>
          </div>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 text-slate-600 hover:text-slate-900 p-2 rounded-lg hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand/40 outline-none transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <form onSubmit={handleAuthSubmit} className="px-6 pt-4 pb-6 space-y-5">
        {!isReset && (
          <div role="tablist" aria-label="Authentication mode" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {[['signin', 'Sign in'], ['signup', 'Sign up']].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={authMode === mode}
                onClick={() => handleAuthModeSwitch(mode)}
                className={`rounded-lg py-2 text-sm font-semibold transition-all ${
                  authMode === mode ? 'bg-surface text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {authInfo && (
          <div role="status" className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 leading-relaxed flex items-start gap-3">
            <MailCheck size={18} className="text-green-600 shrink-0 mt-0.5" />
            <span>{authInfo}</span>
          </div>
        )}
        {authError && (
          <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 leading-relaxed flex items-start gap-3">
            <CircleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        {!isReset && (<>
          <div className="space-y-2.5">
            <button type="button" onClick={handleGithubSignIn} disabled={busy} className={GITHUB_CLASS}>
              {oauthLoading ? <Loader2 className="animate-spin" size={18} /> : <Github size={18} />}
              {isSignup ? 'Sign up with GitHub' : 'Sign in with GitHub'}
            </button>
            <button type="button" onClick={handleGoogleSignIn} disabled={busy} className={OAUTH_CLASS}>
              {oauthLoading ? <Loader2 className="animate-spin" size={18} /> : (
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              {isSignup ? 'Sign up with Google' : 'Sign in with Google'}
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            {isSignup ? 'or sign up with email' : 'or sign in with email'}
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>)}

        <div className="space-y-4">
          <div>
            <label htmlFor="auth-email" className={LABEL_CLASS}>Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                id="auth-email"
                autoFocus
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={INPUT_CLASS}
              />
            </div>
          </div>
          {!isReset && (
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="auth-password" className={LABEL_CLASS}>Password</label>
                {authMode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => handleAuthModeSwitch('reset')}
                    className="text-xs font-semibold text-slate-500 hover:text-brand transition-colors mb-1.5"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  id="auth-password"
                  type={showAuthPassword ? 'text' : 'password'}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder={isSignup ? 'Create a password' : 'Enter your password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  className={`${INPUT_CLASS} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowAuthPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-400 hover:text-slate-700 transition-colors"
                  aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
                >
                  {showAuthPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {isSignup && <p className="mt-1.5 text-xs text-slate-500">Use at least 6 characters.</p>}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-sm active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {authLoading && <Loader2 className="animate-spin" size={16} />}
          {authLoading ? loadingLabel : submitLabel}
        </button>
      </form>

      <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 text-center text-sm text-slate-600">
        {isReset ? (
          <>Remembered it?{' '}
            <button type="button" onClick={() => handleAuthModeSwitch('signin')} className={LINK_CLASS}>Back to sign in</button>
          </>
        ) : isSignup ? (
          <>Already have an account?{' '}
            <button type="button" onClick={() => handleAuthModeSwitch('signin')} className={LINK_CLASS}>Sign in</button>
          </>
        ) : (
          <>New to AppBlips?{' '}
            <button type="button" onClick={() => handleAuthModeSwitch('signup')} className={LINK_CLASS}>Create an account</button>
          </>
        )}
      </div>
    </Modal>
  );
}
