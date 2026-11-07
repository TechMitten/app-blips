import { useEffect, useId, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { ChevronDown, CreditCard, LogOut, UserRound } from 'lucide-react';
import { useRequestSignOut } from '../lib/accountDialogs';
import { untilText } from '../lib/billing';
import { useBillingMe } from '../hooks/useBillingMe';

// The signed-in account button, in the studio picker's top bar and the
// workspace header: an account button (picture and first
// name) that opens a small menu with who is signed in, the plan and
// its build window, and the account actions. Rendered only inside
// <Show when="signed-in"> with accounts on, so Clerk's hooks are available.

const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function initialsOf(user) {
  const name = user.fullName || user.username || user.primaryEmailAddress?.emailAddress || '';
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

// Clerk's picture when the person set one (or it came from Google/GitHub),
// else their initials. Clerk's generated placeholder is skipped: initials
// say more about whose account it is.
function Avatar({ user, size }) {
  const [failed, setFailed] = useState(false);
  const showImage = user.hasImage && user.imageUrl && !failed;
  return (
    <span className="studio-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {showImage
        ? <img src={user.imageUrl} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : initialsOf(user)}
    </span>
  );
}

// Plan state as one short label and a tone for the status pill.
function planStatus(me, loading) {
  if (loading) return null;
  if (!me) return { label: 'Plan unavailable', tone: 'muted', detail: 'Could not load your plan. Check your internet connection.' };
  if (!me.active) return { label: 'Own AI key', tone: 'muted', detail: 'No plan. You build with your own AI key.' };
  if (me.cancelAt) return { label: `Ends ${shortDate(me.cancelAt)}`, tone: 'warn', detail: `Cancelled. It won’t renew.` };
  return { label: 'Active', tone: 'ok', detail: 'Renews every month.' };
}

function UsageMeter({ usage }) {
  const [now] = useState(() => Date.now());
  const resetAt = usage.resetAt ? Date.parse(usage.resetAt) : 0;
  const running = resetAt > now;
  const used = running ? usage.used : 0;
  const percent = Math.min(100, Math.round((used / usage.limit) * 100));
  const full = used >= usage.limit;
  return (
    <div className="studio-account-usage">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="studio-text-soft">Builds</span>
        <span className="studio-text-strong font-semibold tabular-nums">
          {used} <span className="studio-text-soft font-normal">/ {usage.limit}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Builds used in this window"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={used}
        aria-valuetext={`${used} of ${usage.limit} builds used`}
        className="studio-account-bar"
      >
        <span data-level={full ? 'full' : percent >= 80 ? 'high' : 'ok'} style={{ width: `${percent}%` }} />
      </div>
      <p className="studio-text-soft text-[11px] leading-snug">
        {running
          ? `Resets in ${untilText(resetAt - now)}.`
          : `Up to ${usage.limit} builds every ${usage.windowHours} hours.`}
      </p>
    </div>
  );
}

export default function StudioAccountMenu({ onOpenAccount, onOpenPlans }) {
  const { user } = useUser();
  const { me, loading } = useBillingMe(true);
  const requestSignOut = useRequestSignOut();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Outside click closes; Escape closes before the picker's own Escape (go
  // back) sees it: capture phase plus preventDefault, which that handler checks.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open]);

  // Menu keyboard: arrows/Home/End move between items; Tab leaves and closes.
  const onMenuKeyDown = (event) => {
    if (event.key === 'Tab') { setOpen(false); return; }
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const index = items.indexOf(document.activeElement);
    const next = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };

  if (!user) return null;

  const firstName = user.firstName || user.username || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Account';
  const displayName = user.fullName || user.username || firstName;
  const email = user.primaryEmailAddress?.emailAddress;
  const status = planStatus(me, loading);
  const planLabel = me?.active ? me.planName : null;
  const run = (fn) => () => { close(false); fn?.(); };

  return (
    <div ref={rootRef} className="studio-account relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: signed in as ${displayName}`}
        className="studio-account-trigger studio-focus"
        data-open={open}
      >
        <Avatar user={user} size={28} />
        <span className="studio-account-name max-md:hidden">{firstName}</span>
        <ChevronDown size={14} className="studio-account-chevron max-md:hidden" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="studio-account-menu"
        >
          <div className="studio-account-head">
            <Avatar user={user} size={40} />
            <div className="min-w-0 flex-1">
              <p className="studio-text-strong truncate text-sm font-semibold">{displayName}</p>
              {email && <p className="studio-text-soft truncate text-xs">{email}</p>}
            </div>
          </div>

          <div className="studio-account-plan">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="studio-text-soft text-[11px] font-medium uppercase tracking-wide">Plan</p>
                <p className="studio-text-strong truncate text-sm font-semibold">
                  {loading ? 'Loading…' : planLabel || 'No plan'}
                </p>
              </div>
              {status && <span className="studio-status-pill" data-tone={status.tone}>{status.label}</span>}
            </div>
            {status && !(me?.active && me.usage) && (
              <p className="studio-text-soft text-[11px] leading-snug">{status.detail}</p>
            )}
            {me?.active && me.usage && <UsageMeter usage={me.usage} />}
          </div>

          <div className="studio-account-items">
            <button type="button" role="menuitem" className="studio-account-item studio-focus" onClick={run(onOpenAccount)}>
              <UserRound size={16} aria-hidden="true" /> Account settings
            </button>
            <button type="button" role="menuitem" className="studio-account-item studio-focus" onClick={run(onOpenPlans)}>
              <CreditCard size={16} aria-hidden="true" /> {me?.active ? 'Manage plan' : 'See plans'}
            </button>
            <div className="studio-menu-sep" role="separator" />
            <button type="button" role="menuitem" className="studio-account-item studio-focus" onClick={run(requestSignOut)}>
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
