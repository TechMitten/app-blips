import { cloneElement, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { SignIn, SignInButton, SignUp, SignUpButton, UserButton, useAuth, useClerk } from '@clerk/react';
import { Loader2, LogOut } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import Modal, { ModalCloseButton } from './Modal';
import { logError } from '../lib/errorLog';
import { OpenSignInContext, RequestSignOutContext, useOpenSignIn, useRequestSignOut } from '../lib/accountDialogs';
import { canSignInWithBrowser, cancelBrowserSignIn, useBrowserSignInStatus } from '../lib/browserSignIn';

// The account dialogs, held by one provider (mounted by AuthSession) so a
// button inside a menu that closes on click (the mobile menus) can still
// open them:
// - "Sign out of AppBlips?": every Sign out asks first, since signing out
//   quietly moves the person from their plan to their own AI key, and it's
//   easy to do by accident from an icon-only button.
// - The desktop app's sign-in dialog: Clerk's form, whose Google and GitHub
//   buttons go through the web browser there (lib/browserSignIn.js), with
//   how that's going shown under it. Clerk's own pop-up has no room for that
//   and its switch link leaves the app.

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
            zIndex={1300} // above setup (onboarding), where it can be asked for too
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
        {/* virtual routing: the form's own steps stay inside the dialog. */}
        {signingUp
          ? <SignUp key="sign-up" routing="virtual" appearance={NO_CLERK_SWITCH_LINK} />
          : <SignIn key="sign-in" routing="virtual" appearance={NO_CLERK_SWITCH_LINK} />}
        <BrowserSignInStatus />
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

// Desktop only: how a Google/GitHub sign-in in the web browser is going
// (started from Clerk's own buttons, lib/browserSignIn.js). `variant` picks
// the onboarding look (always dark) or the app's theme.
export function BrowserSignInStatus({ variant = 'app' }) {
  const status = useBrowserSignInStatus();
  if (!canSignInWithBrowser || status.kind === 'idle') return null;
  const onboarding = variant === 'onboarding';
  const noteClass = onboarding ? 'onboarding-social-note' : 'text-center text-sm leading-relaxed text-slate-600';
  if (status.kind === 'error') {
    return <p className={onboarding ? 'onboarding-social-note is-error' : 'text-center text-sm leading-relaxed text-red-600'} role="alert">{status.message}</p>;
  }
  return (
    <p className={noteClass} role="status">
      <Loader2 className="inline animate-spin align-[-3px]" size={15} />{' '}
      {status.kind === 'finishing' ? 'Signing you in…' : (
        <>
          Finish signing in with {status.provider === 'github' ? 'GitHub' : 'Google'} in your web browser, then come back here.{' '}
          <button type="button" className="underline underline-offset-2" onClick={cancelBrowserSignIn}>Cancel</button>
        </>
      )}
    </p>
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
