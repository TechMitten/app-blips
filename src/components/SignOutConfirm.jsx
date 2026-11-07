import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserButton, useClerk } from '@clerk/react';
import { LogOut } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { logError } from '../lib/errorLog';
import { RequestSignOutContext, useRequestSignOut } from '../lib/requestSignOut';

// Every "Sign out" in the app (header, studio picker, the account menu) asks
// first: signing out silently switches the person from their plan to their
// own AI key, which is easy to do by accident from an icon-only button.
// One provider holds the dialog, so a button inside a menu that closes on
// click (the mobile menu) can still open it.

export function SignOutConfirmProvider({ children }) {
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useCallback(() => setOpen(true), []);

  const confirm = async () => {
    setBusy(true);
    try {
      await signOut({ redirectUrl: '/' });
    } catch (err) {
      logError('Could not sign out', err);
      setBusy(false);
    }
  };

  const value = useMemo(() => request, [request]);
  return (
    <RequestSignOutContext.Provider value={value}>
      {children}
      {open && createPortal(
        <ConfirmModal
          title="Sign out of AppBlips?"
          onClose={() => { if (!busy) setOpen(false); }}
          onConfirm={confirm}
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
    </RequestSignOutContext.Provider>
  );
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
