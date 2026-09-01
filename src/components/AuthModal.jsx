import { useState, useRef } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import { supabase } from '../supabase';
import { TURNSTILE_SITE_KEY } from '../lib/constants';
import { User, Mail, X, Loader2, Eye, EyeOff } from 'lucide-react';
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
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRef = useRef(null);
  // The theme toggle isn't reachable while this modal is open, so reading the
  // applied class once is enough to match the widget to the current theme.
  const [captchaTheme] = useState(
    () => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  );

  const resetCaptcha = () => {
    captchaRef.current?.reset();
    setCaptchaToken(null);
  };

  const handleAuthModeSwitch = (mode) => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthInfo(null);
    resetCaptcha();
  };

  const handleAuthSubmit = async (e) => {
    e?.preventDefault();
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthError('Enter your email and password.');
      return;
    }
    if (!captchaToken) {
      setAuthError('Please complete the verification check.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    setAuthInfo(null);

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: authPassword,
          options: { captchaToken },
        });
        if (error) throw error;
        if (!data?.session) {
          // Email confirmation required. Stay on the modal with instructions; the
          // session will land once they confirm and sign in.
          setAuthInfo('We sent a confirmation link to your email. Confirm your account, then sign in.');
        }
        // If a session was returned (confirmation disabled), onAuthStateChange
        // closes the modal.
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: authPassword,
          options: { captchaToken },
        });
        if (error) throw error;
        // onAuthStateChange closes the modal on success.
      }
    } catch (err) {
      setAuthError(err?.message || 'Authentication failed.');
      setAuthInfo(null);
    } finally {
      // Tokens are single-use; always start a fresh challenge so the next
      // attempt (retry, or the sign-in after confirming via email) works.
      resetCaptcha();
      setAuthLoading(false);
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
            {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
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

        <div className="flex justify-center min-h-[65px]">
          <Turnstile
            ref={captchaRef}
            siteKey={TURNSTILE_SITE_KEY}
            onSuccess={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
            onError={() => setCaptchaToken(null)}
            options={{ theme: captchaTheme, size: 'flexible' }}
          />
        </div>

        {authMode === 'signup' ? (
          <p className="text-xs text-slate-400 leading-relaxed">
            Your generated apps and version history sync to your account and are only visible to you.
          </p>
        ) : (
          <p className="text-xs text-slate-400 leading-relaxed">
            Sign in to start creating apps with Orion.
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
            disabled={authLoading}
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
          <>New to Orion?{' '}
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
