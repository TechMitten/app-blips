import { useRef, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import authProvider from '../lib/auth';
import { LogIn, UserPlus, KeyRound, Mail, Lock, X, Loader2, Eye, EyeOff, CircleAlert, MailCheck } from 'lucide-react';
import Modal from './Modal';
import { TURNSTILE_SITE_KEY } from '../lib/constants';
import { isPlausibleEmail, suggestEmailFix } from '../lib/emailCheck';

const INPUT_CLASS = 'w-full h-11 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:bg-surface focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none transition-all';
const LABEL_CLASS = 'block text-sm font-medium text-slate-700 mb-1.5';
const LINK_CLASS = 'font-semibold text-brand hover:underline underline-offset-2 transition-colors';

// Self-contained sign-in / sign-up modal (same pattern as
// AccountSettingsModal): owns its form state and talks to the auth adapter
// directly (only ever mounted when supabaseEnabled -- see App.jsx). The
// auth-state listener in useAuth closes the modal the moment a session lands.
export default function AuthModal({ onClose = () => {}, dismissible = true, linkError = null }) {
  // A failed confirm/reset email link opens on sign-in with its error.
  const [authMode, setAuthMode] = useState(linkError ? 'signin' : 'signup'); // 'signin' | 'signup' | 'reset'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(linkError);
  const [authInfo, setAuthInfo] = useState(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  // Mail to a mistyped address bounces, and enough bounces get the project's
  // auth mail throttled: hold sends until a suspected typo is resolved, and
  // don't re-send a confirmation to an address this modal already mailed.
  const [typoKeptFor, setTypoKeptFor] = useState('');
  const [confirmationSentTo, setConfirmationSentTo] = useState('');
  const captchaRef = useRef(null);

  const resetCaptcha = () => {
    setCaptchaToken('');
    captchaRef.current?.reset();
  };

  const handleAuthModeSwitch = (mode) => {
    setAuthMode(mode);
    setAuthPassword('');
    setAuthPasswordConfirm('');
    setAuthError(null);
    setAuthInfo(null);
    resetCaptcha();
  };

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    const email = authEmail.trim();
    const isReset = authMode === 'reset';
    if (!email || (!isReset && !authPassword)) {
      setAuthError(isReset ? 'Enter your email.' : 'Enter your email and password.');
      return;
    }
    if (authMode === 'signup' && authPassword !== authPasswordConfirm) {
      setAuthError('Passwords do not match.');
      return;
    }
    if (authMode !== 'signin') {
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
    if (authMode === 'signup' && confirmationSentTo === email.toLowerCase()) {
      setAuthError(null);
      setAuthInfo(`We already sent a confirmation link to ${email}. Check your spam folder. If the address is wrong, correct it and sign up again.`);
      return;
    }
    if (!captchaToken) {
      setAuthError('Complete the browser verification to continue.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);

    try {
      if (authMode === 'reset') {
        await authProvider.sendPasswordReset(email, captchaToken);
        setAuthInfo('If an account exists for that email, we sent a password reset link. Check your inbox (and spam).');
      } else if (authMode === 'signup') {
        await authProvider.signUp(email, authPassword, captchaToken);
        setConfirmationSentTo(email.toLowerCase());
        setAuthInfo(`We sent a confirmation link to ${email}. Confirm your account, then sign in.`);
      } else {
        await authProvider.signIn(email, authPassword, captchaToken);
        // onAuthStateChange closes the modal on success.
      }
    } catch (err) {
      // Don't reveal whether an account exists for the address on reset.
      if (authMode === 'reset' && err?.code === 'auth/user-not-found') {
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
        setAuthError("We're getting an unusually high number of sign-ups right now, so we couldn't send your email. Please try again in a few minutes.");
        setAuthInfo(null);
        return;
      }
      setAuthError(err?.message || 'Authentication failed.');
      setAuthInfo(null);
    } finally {
      setAuthLoading(false);
      resetCaptcha();
    }
  };

  const isSignup = authMode === 'signup';
  const isReset = authMode === 'reset';
  const busy = authLoading;
  const trimmedEmail = authEmail.trim();
  const emailFix = authMode !== 'signin' && typoKeptFor !== trimmedEmail ? suggestEmailFix(trimmedEmail) : null;
  const applyEmailFix = () => {
    setAuthEmail(emailFix);
    setAuthError(null);
  };
  const keepTypedEmail = () => {
    setTypoKeptFor(trimmedEmail);
    setAuthError(null);
  };

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
          <div role="tablist" aria-label="Authentication mode" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-black/40 dark:ring-1 dark:ring-white/10">
            {[['signin', 'Sign in'], ['signup', 'Sign up']].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={authMode === mode}
                onClick={() => handleAuthModeSwitch(mode)}
                className={`rounded-lg py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  authMode === mode
                    ? 'bg-surface text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-white/[0.16] dark:text-white dark:shadow-none dark:ring-white/25'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 dark:text-slate-500 dark:hover:text-white dark:hover:bg-white/[0.06]'
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
          {isSignup && (
            <div>
              <label htmlFor="auth-password-confirm" className={LABEL_CLASS}>Confirm password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  id="auth-password-confirm"
                  type={showAuthPassword ? 'text' : 'password'}
                  value={authPasswordConfirm}
                  onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                  placeholder="Enter your password again"
                  autoComplete="new-password"
                  className={`${INPUT_CLASS} pr-11`}
                />
              </div>
              {authPasswordConfirm && authPassword !== authPasswordConfirm && (
                <p className="mt-1.5 text-xs font-medium text-red-600">Passwords do not match.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-[65px] justify-center">
          <Turnstile
            ref={captchaRef}
            siteKey={TURNSTILE_SITE_KEY}
            onSuccess={setCaptchaToken}
            onExpire={() => setCaptchaToken('')}
            onError={() => {
              setCaptchaToken('');
              setAuthError('Browser verification failed. Please try again.');
            }}
            options={{ theme: 'auto', size: 'flexible', refreshExpired: 'auto' }}
          />
        </div>

        <button
          type="submit"
          disabled={busy || !captchaToken || (isSignup && (!authPasswordConfirm || authPassword !== authPasswordConfirm))}
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
