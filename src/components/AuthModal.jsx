import { useEffect, useRef, useState } from 'react';
import authProvider from '../lib/auth';
import { isDesktop } from '../lib/desktop';
import { LogIn, KeyRound, Mail, Lock, X, Loader2, Eye, EyeOff, CircleAlert, MailCheck } from 'lucide-react';
import Modal from './Modal';
import { isPlausibleEmail, suggestEmailFix } from '../lib/emailCheck';

const INPUT_CLASS = 'w-full h-11 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:bg-surface focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none transition-all';
const LABEL_CLASS = 'block text-sm font-medium text-slate-700 mb-1.5';
const PROVIDER_BUTTON_CLASS = 'w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-surface text-sm font-semibold text-slate-800 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';
const LINK_CLASS = 'font-semibold text-brand hover:underline underline-offset-2 transition-colors';

const OAUTH_PROVIDERS = [
  { id: 'google', label: 'Google', Icon: GoogleIcon },
  { id: 'github', label: 'GitHub', Icon: GithubIcon },
];

function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.21-2.36H12v4.47h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.73z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.28a12 12 0 0 0 0 10.78l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.1C6.23 6.87 8.88 4.76 12 4.76z" />
    </svg>
  );
}

function GithubIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z" />
    </svg>
  );
}

// Self-contained sign-in / sign-up modal (same pattern as
// AccountSettingsModal): owns its form state and talks to the auth adapter
// directly (only ever mounted when supabaseEnabled -- see App.jsx). The
// auth-state listener in useAuth closes the modal the moment a session lands.
// New accounts are created with Google or GitHub; email + password remains for
// signing in to (and resetting the password of) existing accounts.
export default function AuthModal({ onClose = () => {}, dismissible = true, linkError = null }) {
  // A failed confirm/reset email link shows its error above the sign-in options.
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'reset'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  // The email fields stay hidden until the email option is picked.
  const [showEmailForm, setShowEmailForm] = useState(Boolean(linkError));
  const [authLoading, setAuthLoading] = useState(false);
  const [oauthProvider, setOauthProvider] = useState(null);
  const [authError, setAuthError] = useState(linkError);
  const [authInfo, setAuthInfo] = useState(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  // Mail to a mistyped address bounces, and enough bounces get the project's
  // auth mail throttled: hold sends until a suspected typo is resolved.
  const [typoKeptFor, setTypoKeptFor] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A desktop sign-in waiting on the browser stops with the modal.
      authProvider.cancelOAuth?.();
    };
  }, []);

  const handleAuthModeSwitch = (mode) => {
    setAuthMode(mode);
    setAuthPassword('');
    setAuthError(null);
    setAuthInfo(null);
  };

  const handleOAuth = async (provider) => {
    setAuthError(null);
    setAuthInfo(null);
    setOauthProvider(provider);
    try {
      await authProvider.signInWithOAuth(provider);
      // The web build redirects away; the desktop app signs in here and the
      // auth-state listener closes the modal.
    } catch (err) {
      if (mountedRef.current) setAuthError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      if (mountedRef.current) setOauthProvider(null);
    }
  };

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    const email = authEmail.trim();
    const isReset = authMode === 'reset';
    if (!email || (!isReset && !authPassword)) {
      setAuthError(isReset ? 'Enter your email.' : 'Enter your email and password.');
      return;
    }
    if (isReset) {
      if (!isPlausibleEmail(email)) {
        setAuthError('Enter a valid email address.');
        return;
      }
      const fix = typoKeptFor === email ? null : suggestEmailFix(email);
      if (fix) {
        setAuthError(`Check your email address. Did you mean ${fix}?`);
        return;
      }
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);

    try {
      if (isReset) {
        await authProvider.sendPasswordReset(email);
        setAuthInfo('If an account exists for that email, we sent a password reset link. Check your inbox (and spam).');
      } else {
        await authProvider.signIn(email, authPassword);
        // onAuthStateChange closes the modal on success.
      }
    } catch (err) {
      // Don't reveal whether an account exists for the address on reset.
      if (isReset && err?.code === 'auth/user-not-found') {
        setAuthInfo('If an account exists for that email, we sent a password reset link. Check your inbox (and spam).');
        return;
      }
      // Supabase's per-address interval shares the rate-limit code with the
      // project-wide hourly limit, but names its wait ("after 51 seconds").
      const waitSeconds = err?.code === 'over_email_send_rate_limit' && /after (\d+) seconds?/i.exec(err?.message || '')?.[1];
      if (waitSeconds) {
        setAuthError(`We just sent an email to this address. Please wait ${waitSeconds} seconds before requesting another.`);
        setAuthInfo(null);
        return;
      }
      // Supabase's hourly email limit, or the SMTP provider refusing once its
      // daily quota is spent (surfaces as "Error sending ... email").
      if (err?.code === 'over_email_send_rate_limit' || /error sending .*email/i.test(err?.message || '')) {
        setAuthError("We're getting an unusually high number of requests right now, so we couldn't send your email. Please try again in a few minutes.");
        setAuthInfo(null);
        return;
      }
      setAuthError(err?.message || 'Authentication failed.');
      setAuthInfo(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const isReset = authMode === 'reset';
  const busy = authLoading || Boolean(oauthProvider);
  const trimmedEmail = authEmail.trim();
  const emailFix = isReset && typoKeptFor !== trimmedEmail ? suggestEmailFix(trimmedEmail) : null;
  const applyEmailFix = () => {
    setAuthEmail(emailFix);
    setAuthError(null);
  };
  const keepTypedEmail = () => {
    setTypoKeptFor(trimmedEmail);
    setAuthError(null);
  };

  const title = isReset ? 'Reset your password' : 'Welcome to AppBlips';
  const subtitle = isReset
    ? "Enter your email and we'll send you a link to choose a new password."
    : 'Sign in or create an account to build, save and share your apps.';
  const submitLabel = isReset ? 'Send reset link' : 'Sign in';
  const loadingLabel = isReset ? 'Sending…' : 'Signing in…';
  const HeaderIcon = isReset ? KeyRound : LogIn;
  const showForm = isReset || showEmailForm;

  return (
    <Modal
      zIndex={80}
      cardClass="w-full max-w-md bg-surface rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'auth-title' }}
    >
      <div className="relative px-6 pt-8 pb-6 text-center border-b border-slate-200">
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand/40 outline-none transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
        <div className="mx-auto w-12 h-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center">
          <HeaderIcon size={24} />
        </div>
        <h2 id="auth-title" className="mt-4 text-xl font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1.5 mx-auto max-w-xs text-sm text-slate-600 leading-snug">{subtitle}</p>
      </div>

      <form onSubmit={handleAuthSubmit} className="px-6 py-6 space-y-4">
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

        {!isReset && (
          <div className="space-y-2.5">
            {OAUTH_PROVIDERS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleOAuth(id)}
                disabled={busy}
                className={PROVIDER_BUTTON_CLASS}
              >
                {oauthProvider === id ? <Loader2 className="animate-spin" size={18} /> : <Icon />}
                {oauthProvider === id ? `Waiting for ${label}…` : `Continue with ${label}`}
              </button>
            ))}
            {!showEmailForm && (
              <button type="button" onClick={() => setShowEmailForm(true)} disabled={busy} className={PROVIDER_BUTTON_CLASS}>
                <Mail size={18} />
                Continue with Email
              </button>
            )}
            {oauthProvider && isDesktop && (
              <p className="text-xs text-slate-500 text-center">Finish signing in in your browser, then come back here.</p>
            )}
          </div>
        )}

        {!isReset && showEmailForm && (
          <div className="flex items-center gap-3 pt-1 text-xs font-medium uppercase tracking-wide text-slate-500" role="separator">
            <span className="h-px flex-1 bg-slate-200" />
            or use your email
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        )}

        {showForm && (
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
              {emailFix && (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  Did you mean{' '}
                  <button type="button" onClick={applyEmailFix} className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300">{emailFix}</button>?{' '}
                  <button type="button" onClick={keepTypedEmail} className="text-slate-500 hover:text-slate-800 hover:underline underline-offset-2">Keep as typed</button>
                </p>
              )}
            </div>
            {!isReset && (
              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="auth-password" className={LABEL_CLASS}>Password</label>
                  <button
                    type="button"
                    onClick={() => handleAuthModeSwitch('reset')}
                    className="text-xs font-semibold text-slate-500 hover:text-brand transition-colors mb-1.5"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    id="auth-password"
                    type={showAuthPassword ? 'text' : 'password'}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
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
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-sm active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {authLoading && <Loader2 className="animate-spin" size={16} />}
              {authLoading ? loadingLabel : submitLabel}
            </button>
          </div>
        )}
      </form>

      <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 text-center text-xs text-slate-600 leading-relaxed">
        {isReset ? (
          <>Remembered it?{' '}
            <button type="button" onClick={() => handleAuthModeSwitch('signin')} className={LINK_CLASS}>Back to sign in</button>
          </>
        ) : showEmailForm ? (
          <>Email sign-in is for existing accounts.{' '}
            <button type="button" onClick={() => setShowEmailForm(false)} disabled={busy} className={LINK_CLASS}>Other options</button>
          </>
        ) : (
          'New here? Continue with Google or GitHub.'
        )}
      </div>
    </Modal>
  );
}
