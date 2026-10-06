import { useEffect, useRef, useState } from 'react';
import authProvider from '../lib/auth';
import { LogIn, X, Loader2, CircleAlert } from 'lucide-react';
import Modal from './Modal';
import { maintenanceMode } from '../lib/maintenance';

const PROVIDER_BUTTON_CLASS = 'w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-surface text-sm font-semibold text-slate-800 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

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
// AccountSettingsModal): owns its state and talks to the auth adapter
// directly (only ever mounted when firebaseEnabled -- see App.jsx). Accounts
// are Google or GitHub only, signed in through a popup; the auth-state
// listener in useAuth closes the modal the moment a session lands.
export default function AuthModal({ onClose = () => {}, dismissible = true }) {
  const [oauthProvider, setOauthProvider] = useState(null);
  const [authError, setAuthError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleOAuth = async (provider) => {
    setAuthError(null);
    setOauthProvider(provider);
    try {
      await authProvider.signInWithOAuth(provider);
    } catch (err) {
      if (mountedRef.current) setAuthError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      if (mountedRef.current) setOauthProvider(null);
    }
  };

  const subtitle = maintenanceMode
    ? 'Sign in to your account. New sign-ups are paused during maintenance.'
    : 'Sign in or create an account to build, save and share your apps.';

  return (
    <Modal
      zIndex={80}
      cardClass="w-full max-w-md bg-surface rounded-2xl shadow-2xl border border-slate-300 overflow-hidden animate-scale-in"
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
          <LogIn size={24} />
        </div>
        <h2 id="auth-title" className="mt-4 text-xl font-bold tracking-tight text-slate-900">Welcome to AppBlips</h2>
        <p className="mt-1.5 mx-auto max-w-xs text-sm text-slate-600 leading-snug">{subtitle}</p>
      </div>

      <div className="px-6 py-6 space-y-4">
        {authError && (
          <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 leading-relaxed flex items-start gap-3">
            <CircleAlert size={18} className="text-red-500 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        <div className="space-y-2.5">
          {OAUTH_PROVIDERS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => handleOAuth(id)}
              disabled={Boolean(oauthProvider)}
              className={PROVIDER_BUTTON_CLASS}
            >
              {oauthProvider === id ? <Loader2 className="animate-spin" size={18} /> : <Icon />}
              {oauthProvider === id ? `Waiting for ${label}…` : `Continue with ${label}`}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 text-center text-xs text-slate-600 leading-relaxed">
        {maintenanceMode
          // The block itself is Firebase's "Enable create (sign-up)" switch;
          // this only tells people before they try.
          ? 'New sign-ups are paused while AppBlips is down for maintenance.'
          : 'New here? Continue with Google or GitHub to create your account.'}
      </div>
    </Modal>
  );
}
