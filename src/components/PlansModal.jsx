import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { PLANS, PAID_PLAN_IDS, TRIAL, usageMultiple } from '../../functions/_lib/plans.js';
import { startCheckout, openBillingPortal, endTrial, usagePercent } from '../lib/billing';
import { maintenanceMode } from '../lib/maintenance';

// What each plan card lists. No token counts or model names: Pro is sold as
// a multiple of Plus's monthly usage (usageMultiple, rounded down). The
// landing page (AppBlips-Landing PricingPage.tsx) repeats these words; keep
// them in step.
const PLAN_FEATURES = {
  plus: [
    'Monthly usage allowance',
    'Build apps, websites, and games',
    'Live preview and publishing',
  ],
  pro: [
    `${usageMultiple('pro')}x Plus's monthly usage`,
    'Everything in Plus',
    'For heavy building',
  ],
};

const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);

// Brand blues, cyan and white: the celebration stays on-palette.
const CONFETTI_COLORS = ['#1e598f', '#3987d0', '#81afda', '#22d3ee', '#ffffff'];

// A short two-sided burst once a payment lands. Loaded on demand so the
// library never weighs on a normal page load; skipped for reduced motion.
const celebrate = async () => {
  const { default: confetti } = await import('canvas-confetti');
  const shared = { colors: CONFETTI_COLORS, zIndex: 100, disableForReducedMotion: true, ticks: 220 };
  confetti({ ...shared, particleCount: 90, spread: 70, origin: { x: 0.5, y: 0.35 } });
  setTimeout(() => {
    confetti({ ...shared, particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.6 } });
    confetti({ ...shared, particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.6 } });
  }, 250);
};

// `detail` replaces the "N% used" readout.
function Meter({ label, used, limit, detail = null }) {
  const percent = usagePercent(used, limit);
  // A build is a small share of a monthly allowance (a game is well under 1%
  // of Plus) and would round to 0%, reading as if nothing was counted.
  const under1 = percent === 0 && Number(used) > 0 && Boolean(limit);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs font-medium text-slate-600">
        <span>{label}</span>
        <span className="tabular-nums">{detail || `${under1 ? '<1' : percent}% used`}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${percent >= 90 ? 'bg-rose-500' : 'bg-brand'}`} style={{ width: under1 ? '4px' : `${percent}%` }} />
      </div>
    </div>
  );
}

// Plans + usage. `reason` explains why it opened (no plan yet, a limit was
// reached); `welcome` = opened right after sign-up; `checkoutResult` is set
// when Stripe Checkout just sent the user back; `onRefresh` reloads the
// status after a change made from here.
export default function PlansModal({ status, reason = null, welcome = false, checkoutResult = null, onRefresh, onClose }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const current = PLANS[status?.plan] || PLANS.none;
  const isPaid = current.id !== 'none';
  const trialing = Boolean(status?.trialing);
  const trialOffered = status?.trialEligible !== false;

  // Fire once, when the return from Checkout shows the new paid plan (the
  // webhook can land a moment after the redirect, so this waits for it).
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (checkoutResult !== 'success' || !isPaid || celebratedRef.current) return;
    celebratedRef.current = true;
    celebrate().catch(() => {});
  }, [checkoutResult, isPaid]);

  const run = async (key, action) => {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setBusy(null);
    }
  };

  const renewal = shortDate(status?.periodEnd);
  const trialEnd = shortDate(status?.trialEnd);

  // Ends the trial so Plus (and its full allowance) starts now, charged today.
  const startPlusNow = () => run('end-trial', async () => {
    await endTrial();
    await onRefresh?.();
    setBusy(null);
  });

  return (
    <Modal zIndex={80} cardClass="plans-modal w-full max-w-3xl bg-surface rounded-2xl border border-slate-200 overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-9 h-9 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
            <Sparkles size={18} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Plans</h2>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      <div className="p-6 overflow-y-auto custom-scrollbar space-y-5">
        {checkoutResult === 'success' && !isPaid && status?.trialRefused && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This card has already been used for a free trial, so the trial wasn't started and nothing was charged. You can still subscribe to {PLANS[TRIAL.plan].label} below, without a trial.
          </div>
        )}
        {checkoutResult === 'success' && !(!isPaid && status?.trialRefused) && (
          <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
            {trialing
              ? `Your ${TRIAL.days}-day free trial has started. Cancel before ${trialEnd || 'it ends'} and you won't be charged.`
              : isPaid ? `You're on ${current.label}. Thanks for subscribing!` : 'All set. Your plan will update in a moment.'}
          </div>
        )}
        {checkoutResult === 'cancelled' && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Checkout was cancelled. Nothing was charged.
          </div>
        )}
        {maintenanceMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Upgrades are paused while AppBlips is down for maintenance. Nothing will be charged.
          </div>
        )}
        {welcome && !isPaid && (
          <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-slate-700">
            Welcome to AppBlips! Pick a plan to start building.
          </div>
        )}
        {reason && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{reason}</div>
        )}

        {status?.enabled && (
          <div className="plans-panel rounded-xl p-4 space-y-3">
            {!isPaid ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  {trialOffered ? `Start your free ${TRIAL.days}-day trial to build` : "You don't have a plan"}
                </p>
                {trialOffered && (
                  <p className="text-xs text-slate-500">
                    You won't be charged until it ends, and you can cancel anytime before then.
                  </p>
                )}
              </div>
            ) : trialing ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">You're on the free trial</p>
                  {trialEnd && (
                    <p className="text-xs text-slate-500">
                      {status.cancelAtPeriodEnd ? `Ends ${trialEnd}, no charge` : `Ends ${trialEnd}, then $${current.price}/month`}
                    </p>
                  )}
                </div>
                <Meter label="Trial allowance" used={status.periodTokens} limit={status.limits?.periodTokens} />
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {!status.cancelAtPeriodEnd && (
                    <button
                      type="button"
                      onClick={startPlusNow}
                      disabled={Boolean(busy) || maintenanceMode}
                      className="text-sm font-semibold text-brand hover:underline disabled:opacity-60"
                    >
                      {busy === 'end-trial' ? <Loader2 size={16} className="animate-spin" /> : 'Start Plus now'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run('portal', openBillingPortal)}
                    disabled={Boolean(busy)}
                    className="text-sm font-semibold text-slate-600 hover:underline disabled:opacity-60"
                  >
                    {busy === 'portal' ? <Loader2 size={16} className="animate-spin" /> : status.cancelAtPeriodEnd ? 'Keep Plus' : 'Cancel trial'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">You're on {current.label}</p>
                  {renewal && (
                    <p className="text-xs text-slate-500">{status.cancelAtPeriodEnd ? `Ends ${renewal}` : `Renews ${renewal}`}</p>
                  )}
                </div>
                <Meter label="This billing period" used={status.periodTokens} limit={current.periodTokens} />
              </>
            )}
          </div>
        )}

        <div className={`grid gap-3 ${(!isPaid && trialOffered) ? 'md:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {!isPaid && trialOffered && (
            <div className="plans-panel plans-panel--plan rounded-xl p-4 flex flex-col">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Free Trial</p>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                $0<span className="text-sm font-medium text-slate-500 dark:text-white/60">/first {TRIAL.days} days</span>
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-white/70 flex-1">
                {['Trial usage allowance', 'Build apps, websites, and games', 'Live preview and publishing'].map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-col justify-end">
                <p className="mb-3 text-[11px] leading-tight text-slate-500 dark:text-white/50">
                  Card required. ${PLANS[TRIAL.plan].price}/month after {TRIAL.days} days unless you cancel.
                </p>
                <button
                  type="button"
                  onClick={() => run('trial', () => startCheckout(TRIAL.plan, true))}
                  disabled={Boolean(busy) || !status?.enabled || maintenanceMode}
                  className="brand-fill-text w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                >
                  {busy === 'trial' ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'Start free trial'}
                </button>
              </div>
            </div>
          )}
          {PAID_PLAN_IDS.map((id) => PLANS[id]).map((plan) => {
            // A trial is a Plus subscription under the hood, but the user isn't on
            // Plus yet, so don't badge it as current alongside the trial banner.
            const isCurrent = plan.id === current.id && !trialing;
            const isTrialTarget = plan.id === current.id && trialing;
            return (
              <div key={plan.id} className={`plans-panel plans-panel--plan rounded-xl p-4 flex flex-col ${isCurrent ? 'plans-panel--current' : ''}`}>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{plan.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                  ${plan.price}<span className="text-sm font-medium text-slate-500 dark:text-white/60">/month</span>
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-white/70 flex-1">
                  {PLAN_FEATURES[plan.id].map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-col justify-end">
                  {isCurrent || isTrialTarget ? (
                    <button type="button" disabled className="w-full rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2 text-sm font-semibold text-slate-500 dark:text-white/50">
                      {isCurrent ? 'Current plan' : status?.cancelAtPeriodEnd ? 'Trial cancelled' : `Starts after trial${trialEnd ? ` (${trialEnd})` : ''}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => run(plan.id, () => startCheckout(plan.id))}
                      disabled={Boolean(busy) || !status?.enabled || maintenanceMode}
                      className="w-full rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-60"
                    >
                      {busy === plan.id ? <Loader2 size={16} className="mx-auto animate-spin" /> : isPaid ? `Switch to ${plan.label}` : `Subscribe to ${plan.label}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Matches the Stripe portal setting: cancelling takes effect at the
              end of the period already paid for. */}
          <p className="text-xs text-slate-500">
            Every plan has a monthly usage allowance, and the trial has a smaller one. When you run out, new prompts wait until it resets; a build that has started always finishes.
            {' '}Cancel anytime. Cancel during the trial and you won't be charged; after that, you keep your plan until the end of the month you've paid for.
          </p>
          {isPaid && !trialing && (
            <button
              type="button"
              onClick={() => run('portal', openBillingPortal)}
              disabled={Boolean(busy)}
              className="text-sm font-semibold text-brand hover:underline disabled:opacity-60"
            >
              Manage billing and invoices
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
