import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, useClerk, useReverification, useUser } from '@clerk/react';
import { LogOut, Trash2 } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { AuthButton } from './AccountDialogs';
import { FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON, SettingRow } from './SettingControls';
import { deleteAccountOnServer, untilText } from '../lib/billing';
import { useBillingMe } from '../hooks/useBillingMe';
import { useRequestSignOut } from '../lib/accountDialogs';
import { CancelPlanRow } from './PlanSettings';
import { logError } from '../lib/errorLog';

// Settings → Account (only where accounts exist, see lib/accounts.js): who is
// signed in, their plan and how much of the build window (plans.js
// windowBuilds / windowHours) they've used, their password, the Google /
// GitHub accounts they sign in with. Cancelling the plan and deleting the
// account live in Settings → Danger Zone (AccountDangerZone below).
//
// Password, connected accounts and deleting go through Clerk's
// useReverification: the instance asks people to prove who they are again
// before these, and the hook shows Clerk's own prompt and then retries.

const DANGER_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50';

const longDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });


// Clerk errors carry their readable text in errors[0]; ours in message.
const errorText = (err, fallback) => err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || fallback;

// Closing Clerk's "confirm it's you" prompt isn't a failure worth showing.
const isCancelled = (err) => err?.code === 'reverification_cancelled' || err?.errors?.[0]?.code === 'reverification_cancelled';

function ProfileRow({ user }) {
  const requestSignOut = useRequestSignOut();
  const email = user.primaryEmailAddress?.emailAddress || '';
  const name = user.fullName || user.username || email || 'Your account';
  return (
    <SettingRow
      id="set-account-profile"
      title={(
        <span className="flex items-center gap-3">
          {user.imageUrl && <img src={user.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />}
          <span className="min-w-0">
            <span className="block truncate">{name}</span>
            {email && name !== email && <span className="block truncate text-xs font-normal text-slate-600">{email}</span>}
          </span>
        </span>
      )}
      description={user.createdAt ? `Member since ${longDate(user.createdAt)}` : null}
    >
      <button type="button" className={SECONDARY_BUTTON} onClick={requestSignOut}>
        <LogOut size={14} aria-hidden="true" />
        Sign out
      </button>
    </SettingRow>
  );
}

function PlanRow({ me, loading, onOpenPlan }) {
  let description;
  if (loading) description = 'Loading your plan…';
  else if (!me) description = 'Could not load your plan. Check your internet connection.';
  else if (!me.active) description = 'No active plan. Subscribe to build with AppBlips AI, no API key needed.';
  else if (me.cancelAt) description = `${me.planName} plan, cancelled: it ends on ${longDate(me.cancelAt)} and won’t renew.`;
  else description = `${me.planName} plan, active. It renews every month.`;
  return (
    <SettingRow id="set-account-plan" title="Plan" description={description}>
      <div className="flex items-center gap-2">
        {me && (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            {me.active ? me.planName : 'None'}
          </span>
        )}
        <button type="button" className={SECONDARY_BUTTON} onClick={onOpenPlan}>
          {me?.active ? 'Manage plan' : 'See plans'}
        </button>
      </div>
    </SettingRow>
  );
}

// The plan's build window: N of 50 used, and when it unlocks. The count only
// changes when a build runs, so the row re-reads the server on open and
// just keeps the countdown current while Settings stays open.
function UsageRow({ usage }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const resetAt = usage.resetAt ? Date.parse(usage.resetAt) : 0;
  const running = resetAt > now;
  const used = running ? usage.used : 0;
  const left = Math.max(0, usage.limit - used);
  const percent = Math.min(100, Math.round((used / usage.limit) * 100));
  const full = left === 0;

  const description = !running
    ? `Your plan includes up to ${usage.limit} builds every ${usage.windowHours} hours. Your next build starts a new ${usage.windowHours}-hour window.`
    : full
      ? `You’ve used all ${usage.limit} builds in this window. Building unlocks again in ${untilText(resetAt - now)}.`
      : `${left} left. This window resets in ${untilText(resetAt - now)}, at ${new Date(resetAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`;

  return (
    <SettingRow
      id="set-account-usage"
      title={`Builds in this ${usage.windowHours}-hour window`}
      description={description}
      details={(
        <div>
          <div
            role="progressbar"
            aria-labelledby="set-account-usage"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={used}
            aria-valuetext={`${used} of ${usage.limit} builds used`}
            className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${full ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Questions in Ask mode and automatic error fixes don’t count as builds.
          </p>
        </div>
      )}
    >
      <span className="text-sm font-semibold tabular-nums text-slate-900">
        {used} <span className="font-normal text-slate-500">of {usage.limit} used</span>
      </span>
    </SettingRow>
  );
}

function PasswordRow({ user }) {
  const hasPassword = user.passwordEnabled;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const updatePassword = useReverification((params) => user.updatePassword(params));

  const close = () => {
    setOpen(false);
    setCurrent(''); setNext(''); setRepeat('');
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (next !== repeat) {
      setError('The new passwords don’t match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updatePassword({
        newPassword: next,
        ...(hasPassword ? { currentPassword: current } : {}),
        signOutOfOtherSessions: signOutOthers,
      });
      close();
      setDone(hasPassword ? 'Password changed.' : 'Password set. You can now sign in with it.');
    } catch (err) {
      if (!isCancelled(err)) setError(errorText(err, 'Could not update your password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      id="set-account-password"
      title="Password"
      description={done || (hasPassword
        ? 'Change the password you use to sign in.'
        : 'You sign in with a code sent to your email, or with Google or GitHub. Add a password to sign in with it too.')}
      details={open && (
        <form onSubmit={submit} className="space-y-2.5 max-w-sm">
          {hasPassword && (
            <label className="block text-xs font-semibold text-slate-700">
              Current password
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={`${FIELD_CLASS} mt-1`} />
            </label>
          )}
          <label className="block text-xs font-semibold text-slate-700">
            New password
            <input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} className={`${FIELD_CLASS} mt-1`} />
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Type the new password again
            <input type="password" autoComplete="new-password" required minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} className={`${FIELD_CLASS} mt-1`} />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
            Sign out on my other devices
          </label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
            </button>
            <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={close}>Cancel</button>
          </div>
        </form>
      )}
    >
      {!open && (
        <button type="button" className={SECONDARY_BUTTON} onClick={() => { setDone(''); setOpen(true); }}>
          {hasPassword ? 'Change password' : 'Set a password'}
        </button>
      )}
    </SettingRow>
  );
}

// Google / GitHub accounts linked to this one. Disconnecting only stops that
// way of signing in; the account, plan and projects stay. Connecting a new
// one isn't offered here: on desktop it has to go through the web browser
// (lib/browserSignIn.js), and signing in with Google or GitHub on an
// account with the same email links it anyway.
function ConnectedAccountsRow({ user }) {
  const [confirming, setConfirming] = useState(null); // external account id
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disconnect = useReverification((account) => account.destroy());
  const accounts = user.externalAccounts || [];
  const email = user.primaryEmailAddress?.emailAddress || '';

  // Keep a way in: an email (sign-in codes go to it), a password, or another
  // connected account. Clerk refuses removing the last one too; this just
  // says so before anyone tries.
  const canDisconnect = (account) => Boolean(email) || user.passwordEnabled || accounts.some((other) => other.id !== account.id);

  const run = async (account) => {
    setBusy(true);
    setError('');
    try {
      await disconnect(account);
      await user.reload();
      setConfirming(null);
    } catch (err) {
      if (!isCancelled(err)) setError(errorText(err, 'Could not disconnect that account.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      id="set-account-connected"
      title="Connected accounts"
      description={accounts.length
        ? 'Accounts you can sign in with. Disconnecting one only removes that way of signing in.'
        : 'No Google or GitHub account is connected. Signing in with Google or GitHub using the same email connects it.'}
      details={accounts.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {accounts.map((account) => {
            const provider = account.providerTitle?.() || account.provider;
            const identity = account.emailAddress || account.username || '';
            const allowed = canDisconnect(account);
            return (
              <li key={account.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{provider}</p>
                  {identity && <p className="truncate text-xs text-slate-600">{identity}</p>}
                  {confirming === account.id && (
                    <p className="mt-1 text-xs text-slate-700">
                      Disconnect {provider}?{email ? ` You can still sign in with a code sent to ${email}.` : ''}
                    </p>
                  )}
                </div>
                {confirming === account.id ? (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => setConfirming(null)}>Keep</button>
                    <button type="button" className={DANGER_BUTTON} disabled={busy} onClick={() => run(account)}>
                      {busy ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`${SECONDARY_BUTTON} shrink-0 self-start sm:self-auto`}
                    disabled={!allowed || busy}
                    title={allowed ? undefined : 'This is your only way to sign in. Set a password first.'}
                    onClick={() => { setError(''); setConfirming(account.id); }}
                  >
                    Disconnect
                  </button>
                )}
              </li>
            );
          })}
          {error && <li role="alert" className="px-3 py-2 text-xs text-red-600">{error}</li>}
        </ul>
      )}
    />
  );
}

const CONFIRM_WORD = 'DELETE';

function DeleteAccountRow({ user, me, loading }) {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The server stops the plan first, then deletes (billing.js
  // handleDeleteAccount); it answers with Clerk's reverification hint when
  // the person needs to confirm who they are, and the hook retries after.
  const deleteOnServer = useReverification(async () => deleteAccountOnServer(await getToken({ skipCache: true })));
  const deleteInClerk = useReverification(() => user.delete());

  // A plan that still renews has to be cancelled first (the row above), so
  // nobody deletes their account expecting the subscription to go with it
  // without having seen how cancelling works. A cancelled plan that hasn't
  // ended yet is fine: deleting just ends it now. Until the plan is known
  // (loading, or the server couldn't be reached) deleting waits too.
  const renewing = Boolean(me?.active && !me.cancelAt);
  const blocked = loading || !me || renewing;
  let description = 'Permanently delete your AppBlips account and stop your plan. Projects saved on this device stay.';
  if (loading) description = 'Checking your plan…';
  else if (!me) description = 'Could not check your plan, so deleting is unavailable for now. Check your internet connection.';
  else if (renewing) description = `Cancel your ${me.planName} plan above first, then you can delete your account. Projects saved on this device stay.`;

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await deleteOnServer();
      // A server without Clerk's secret key leaves the sign-in to the app.
      if (!result?.clerkDeleted) await deleteInClerk();
    } catch (err) {
      if (!isCancelled(err)) setError(errorText(err, 'Could not delete your account.'));
      setBusy(false);
      return;
    }
    // The session went with the user; this just clears what's left here.
    try {
      await signOut({ redirectUrl: '/' });
    } catch (err) {
      logError('Sign-out after deleting the account', err);
      window.location.assign('/');
    }
  };

  return (
    <SettingRow
      id="set-account-delete"
      title="Delete account"
      description={description}
    >
      <button
          type="button"
          className={DANGER_BUTTON}
          disabled={blocked}
          title={renewing ? 'Cancel your plan first.' : undefined}
          onClick={() => { setTyped(''); setError(''); setOpen(true); }}
        >
        <Trash2 size={14} aria-hidden="true" />
        Delete account
      </button>
      {open && createPortal(
        <ConfirmModal
          title="Delete your AppBlips account?"
          zIndex={1300}
          onClose={() => { if (!busy) setOpen(false); }}
          onConfirm={confirm}
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          busy={busy}
          confirmDisabled={typed.trim().toUpperCase() !== CONFIRM_WORD}
          icon={Trash2}
          confirmClass="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>Your sign-in{user.externalAccounts?.length ? ' and connected accounts' : ''} are deleted. This can’t be undone.</li>
            {me?.active && (
              <li>
                Your cancelled {me.planName} plan ends right away{me.cancelAt ? ` instead of on ${longDate(me.cancelAt)}` : ''}. The rest of this billing period isn’t refunded.
              </li>
            )}
            <li>Projects saved on this device stay. You can keep building with your own AI key.</li>
          </ul>
          <label className="block text-sm text-slate-700">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm.
            <input
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              className={`${FIELD_CLASS} mt-1.5`}
            />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </ConfirmModal>,
        document.body,
      )}
    </SettingRow>
  );
}

// Settings → Danger Zone, above deleting projects and the factory reset:
// cancelling the plan, then deleting the account. Both sit together so the
// "cancel first" rule (DeleteAccountRow) reads top to bottom, and cancelling
// unlocks deleting straight away. Signed out, there's nothing to show.
export function AccountDangerZone() {
  const { isSignedIn, user } = useUser();
  const { me, setMe, loading } = useBillingMe(isSignedIn);
  if (!isSignedIn || !user) return null;
  return (
    <>
      {me?.active && (
        <CancelPlanRow
          planName={me.planName}
          cancelAt={me.cancelAt}
          onCancelled={(cancelAt) => setMe((current) => ({ ...current, cancelAt }))}
        />
      )}
      <DeleteAccountRow user={user} me={me} loading={loading} />
    </>
  );
}

export default function AccountSettings({ onOpenPlan }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { me, loading } = useBillingMe(isSignedIn);

  if (!isLoaded) return <p className="p-4 text-sm text-slate-500">Loading account…</p>;
  if (!isSignedIn || !user) {
    return (
      <SettingRow
        id="set-account-signin"
        title="Your AppBlips account"
        description="You’re not signed in, so AppBlips builds with your own AI key. Sign in to see your plan and build usage and to manage your account."
      >
        <AuthButton kind="sign-in">
          <button type="button" className={PRIMARY_BUTTON}>Sign in</button>
        </AuthButton>
      </SettingRow>
    );
  }

  return (
    <>
      <ProfileRow user={user} />
      <PlanRow me={me} loading={loading} onOpenPlan={onOpenPlan} />
      {me?.active && me.usage && <UsageRow usage={me.usage} />}
      <PasswordRow user={user} />
      <ConnectedAccountsRow user={user} />
    </>
  );
}
