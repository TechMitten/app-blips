import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Sparkles, X } from 'lucide-react';
import { CompareModal } from './DesktopOnboarding';
import { useAccounts } from '../lib/accounts';
import { fetchBillingConfig } from '../lib/billing';
import { loadPlansIntroSeen, savePlansIntroSeen } from '../lib/config';
import { providerApi } from '../lib/desktop';
import { logWarn } from '../lib/errorLog';

// One-time "plans are here" notice for people who set up AppBlips with their
// own AI key before plans existed, so never saw onboarding's plan choice.
// Shown only when all of these hold:
//   - this copy has accounts (plans can be bought here at all),
//   - they're signed out (signed in = already a plan user),
//   - they have their own AI provider set up (they're using their own key),
//   - they haven't been shown plans (onboarding's choice step sets the same
//     flag, so anyone who set up since then never gets this),
//   - a plan is on sale.
// Any button, or the close button, hides it for good; their own key keeps
// working whatever they pick. Same size and kind of spot as UpdateNotice, but
// bottom-left so the two don't cover each other, and in the onboarding's dark
// look with fixed colours (plans-notice in desktop-onboarding.css), so it
// reads the same in the light and dark themes.
const SHOW_AFTER_MS = 4000;

const price = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export default function PlansNotice({ onOpenPlans }) {
  // Clerk's hooks need its provider, which exists only with accounts.
  return useAccounts() ? <PlansNoticeInner onOpenPlans={onOpenPlans} /> : null;
}

function PlansNoticeInner({ onOpenPlans }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [plan, setPlan] = useState(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!isLoaded || isSignedIn || loadPlansIntroSeen()) return undefined;
    let cancelled = false;
    // A moment after opening, and never over the launch splash video (it
    // would sit underneath it, washed out), so it doesn't compete with the
    // app appearing.
    let timer = 0;
    const splashPlaying = () => Boolean(document.querySelector('video[aria-label="AppBlips"]'));
    const showWhenClear = (onSale) => {
      if (cancelled) return;
      if (splashPlaying()) { timer = window.setTimeout(() => showWhenClear(onSale), 500); return; }
      setPlan(onSale);
    };
    timer = window.setTimeout(() => {
      Promise.all([providerApi.get(), fetchBillingConfig()]).then(([info, config]) => {
        if (cancelled) return;
        const ownKey = info?.envConfigured || (info?.id && info?.hasKey);
        const onSale = (config.plans || []).find((entry) => !entry.comingSoon);
        if (ownKey && onSale) showWhenClear(onSale);
      }).catch((err) => logWarn('Could not check whether to mention plans', err));
    }, SHOW_AFTER_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [isLoaded, isSignedIn]);

  // Signing in elsewhere (Header, Settings) makes them a plan user.
  if (!plan || isSignedIn) return null;

  const dismiss = () => {
    savePlansIntroSeen();
    setPlan(null);
    setComparing(false);
  };
  const seePlans = () => {
    dismiss();
    onOpenPlans?.();
  };

  return (
    <>
      <div role="status" aria-live="polite" className="plans-notice">
        <div className="flex items-start gap-3">
          <Sparkles size={18} className="plans-notice-icon shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="plans-notice-title">New: AppBlips plans</p>
            <p className="plans-notice-text">
              Rather not manage an API key? AppBlips can run the AI for you for {price(plan.priceCents)}/month
              {plan.betaPricing ? ' during the beta' : ''}. Your own key keeps working as it is.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="plans-notice-primary" onClick={seePlans}>See plans</button>
              <button type="button" className="plans-notice-secondary" onClick={() => setComparing(true)}>Compare options</button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="plans-notice-close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {comparing && (
        <CompareModal
          onClose={() => setComparing(false)}
          onChoose={(choice) => (choice === 'plan' ? seePlans() : dismiss())}
        />
      )}
    </>
  );
}
