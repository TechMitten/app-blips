import { cloneElement, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { SignIn, SignInButton, SignUp, SignUpButton, UserButton, useAuth, useClerk } from '@clerk/react';
import { Github, Loader2, LogOut } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import Modal, { ModalCloseButton } from './Modal';
import { logError } from '../lib/errorLog';
import { OpenSignInContext, RequestSignOutContext, useOpenSignIn, useRequestSignOut } from '../lib/accountDialogs';
import {
  canSignInWithBrowser, cancelBrowserSignIn, startBrowserSignIn, useBrowserSignInStatus,
} from '../lib/browserSignIn';

// The account dialogs, held by one provider (mounted by AuthSession) so a
// button inside a menu that closes on click (the mobile menus) can still
// open them:
// - "Sign out of AppBlips?": every Sign out asks first, since signing out
//   quietly moves the person from their plan to their own AI key, and it's
//   easy to do by accident from an icon-only button.
// - The desktop app's sign-in dialog: Clerk's email form plus Google and
//   GitHub, which go through the web browser (lib/browserSignIn.js). Clerk's
//   own pop-up would offer Google/GitHub buttons that can't work there.

export function AccountDialogsProvider({ children }) {
  const { signOut } = useClerk();
  const { isSignedIn } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signInKind, setSignInKind] = useState(null);
  const requestSignOut = useCallback(() => setSignOutOpen(true), []);
  const openSignIn = useCallback((kind) => {
    cancelBrowserSignIn(); // a fresh dialog, without an earlier attempt's message
    setSignInKind(kind === 'sign-up' ? 'sign-up' : 'sign-in');
  }, []);

  // Signed in (by email or through the browser): the dialog is done, and
  // doesn't come back after a later sign-out.
  if (isSignedIn && signInKind) setSignInKind(null);

  const confirmSignOut = async () => {
    setBusy(true);
    try {
      await signOut({ redirectUrl: '/' });
    } catch (err) {
      logError('Could not sign out', err);
      setBusy(false);
    }
  };

  return (
    <RequestSignOutContext.Provider value={requestSignOut}>
      <OpenSignInContext.Provider value={openSignIn}>
        {children}
        {signOutOpen && createPortal(
          <ConfirmModal
            title="Sign out of AppBlips?"
            onClose={() => { if (!busy) setSignOutOpen(false); }}
            onConfirm={confirmSignOut}
            confirmLabel="Sign out"
            busyLabel="Signing out…"
            busy={busy}
            icon={LogOut}
            confirmClass="brand-fill-text inline-flex items-center gap-2 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-60"
          >
            <p className="text-sm text-slate-600 leading-relaxed">
              Your projects stay where they are. While you’re signed out, AppBlips builds with your own AI key, if you’ve set one up. Sign in again to use your plan.
            </p>
          </ConfirmModal>,
          document.body,
        )}
        {signInKind && createPortal(
          <DesktopSignInDialog kind={signInKind} onClose={() => { cancelBrowserSignIn(); setSignInKind(null); }} />,
          document.body,
        )}
      </OpenSignInContext.Provider>
    </RequestSignOutContext.Provider>
  );
}

// Clerk's own "Sign in" / "Sign up" link goes to its hosted pages
// (accounts.appblips.com), which leave the app, so it's hidden and the link
// below swaps the two forms instead (as onboarding's plan step does).
const NO_CLERK_SWITCH_LINK = { elements: { footerAction: { display: 'none' } } };

function DesktopSignInDialog({ kind, onClose }) {
  const [mode, setMode] = useState(kind);
  const signingUp = mode === 'sign-up';
  return (
    <Modal
      zIndex={1300}
      cardClass="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-y-auto animate-scale-in max-h-[calc(100dvh-2rem)]"
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-base font-semibold text-slate-900">{signingUp ? 'Create your AppBlips account' : 'Sign in to AppBlips'}</h2>
        <ModalCloseButton onClick={onClose} />
      </div>
      <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-3">
        <BrowserSignInButtons />
        {/* virtual routing: the form's own steps stay inside the dialog. */}
        {signingUp
          ? <SignUp key="sign-up" routing="virtual" appearance={NO_CLERK_SWITCH_LINK} />
          : <SignIn key="sign-in" routing="virtual" appearance={NO_CLERK_SWITCH_LINK} />}
        <p className="text-sm text-slate-600">
          {signingUp ? 'Already have an account?' : 'New to AppBlips?'}{' '}
          <button type="button" className="font-semibold text-slate-900 underline underline-offset-2" onClick={() => setMode(signingUp ? 'sign-in' : 'sign-up')}>
            {signingUp ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
    </Modal>
  );
}

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

const PROVIDERS = [
  { id: 'google', label: 'Google', Icon: GoogleIcon },
  { id: 'github', label: 'GitHub', Icon: () => <Github size={16} aria-hidden="true" /> },
];

// Desktop only: Google and GitHub through the web browser. `variant` picks
// the onboarding look (always dark) or the app's theme.
export function BrowserSignInButtons({ variant = 'app' }) {
  const status = useBrowserSignInStatus();
  if (!canSignInWithBrowser) return null;
  const busy = status.kind === 'waiting' || status.kind === 'finishing';
  const onboarding = variant === 'onboarding';
  const buttonClass = onboarding
    ? 'onboarding-social-button'
    : 'inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60';
  const noteClass = onboarding ? 'onboarding-social-note' : 'text-center text-sm leading-relaxed text-slate-600';
  return (
    <div className={onboarding ? 'onboarding-social' : 'flex w-full flex-col gap-2'}>
      <div className={onboarding ? 'onboarding-social-row' : 'flex gap-2'}>
        {PROVIDERS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={buttonClass} disabled={busy} aria-label={`Continue with ${label}`} onClick={() => startBrowserSignIn(id)}>
            <Icon /> {label}
          </button>
        ))}
      </div>
      {status.kind === 'waiting' && (
        <p className={noteClass} role="status">
          <Loader2 className="inline animate-spin align-[-3px]" size={15} /> Finish signing in in your web browser, then come back here.{' '}
          <button type="button" className="underline underline-offset-2" onClick={cancelBrowserSignIn}>Cancel</button>
        </p>
      )}
      {status.kind === 'finishing' && (
        <p className={noteClass} role="status"><Loader2 className="inline animate-spin align-[-3px]" size={15} /> Signing you in…</p>
      )}
      {status.kind === 'error' && (
        <p className={onboarding ? 'onboarding-social-note is-error' : 'text-center text-sm leading-relaxed text-red-600'} role="alert">{status.message}</p>
      )}
      <p className={onboarding ? 'onboarding-social-or' : 'text-center text-xs uppercase tracking-wide text-slate-400'}>or use your email</p>
    </div>
  );
}

// A "Sign in" / "Sign up" button: Clerk's own pop-up on the web; the
// desktop app's dialog (with Google and GitHub) there. `children` is the
// button; its own onClick still runs (e.g. closing a menu).
export function AuthButton({ kind = 'sign-in', children }) {
  const openSignIn = useOpenSignIn();
  if (!canSignInWithBrowser) {
    return kind === 'sign-up'
      ? <SignUpButton mode="modal">{children}</SignUpButton>
      : <SignInButton mode="modal">{children}</SignInButton>;
  }
  return cloneElement(children, {
    onClick: (event) => {
      children.props.onClick?.(event);
      openSignIn(kind);
    },
  });
}

// Clerk's account button, with its menu's own "Sign out" (which signs out at
// once) swapped for one that asks first.
const HIDE_CLERK_SIGN_OUT = { elements: { userButtonPopoverActionButton__signOut: { display: 'none' } } };

export function AccountButton() {
  const requestSignOut = useRequestSignOut();
  return (
    <UserButton appearance={HIDE_CLERK_SIGN_OUT}>
      <UserButton.MenuItems>
        <UserButton.Action label="Sign out" labelIcon={<LogOut size={15} />} onClick={requestSignOut} />
      </UserButton.MenuItems>
    </UserButton>
  );
}
