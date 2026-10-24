import { ConfirmedLink } from './ExternalLinkConfirm';
import { useExternalConfirm } from '../hooks/useExternalConfirm';
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, ExternalLink, TriangleAlert } from 'lucide-react';
import { SettingRow, Switch, FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import { CONNECTOR_DEFINITIONS, SITE_KEY_RE } from '../lib/connectors';
import { POLLINATIONS_EARNINGS, POLLINATIONS_FEE_NOTE } from '../lib/pollinationsApp';
import {
  checkSiteKey, pollinationsCheckLogin, pollinationsSignOut, pollinationsStartLogin, pollinationsStatus,
} from '../lib/pollinations';

// Settings → Connectors → Pollinations. Unlike the other connectors there is
// no key to paste: the user signs in (device flow, run server-side by
// electron/server/pollinationsApi.js) and the page only ever learns the
// account name. Below it the user picks who pays for AI features in their
// sites; the site key, if they pick it, is the one secret value that does go
// into them, hence the warnings and the budget check.
const POLL_MS = 3000;

const formatPollen = (value) => (typeof value === 'number' ? `${Math.round(value * 100) / 100} Pollen` : '');

function SignIn({ account, onAccount }) {
  const { page } = CONNECTOR_DEFINITIONS.pollinations;
  const { ask, dialog } = useExternalConfirm();
  // checking | signed-out | starting | waiting | signed-in
  const [step, setStep] = useState(account ? 'signed-in' : 'checking');
  const [balance, setBalance] = useState(null);
  const [code, setCode] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // The server is the truth: a key can expire or be revoked meanwhile.
    pollinationsStatus().then((status) => {
      if (!mounted.current || status.error) {
        if (mounted.current) setStep(account ? 'signed-in' : 'signed-out');
        return;
      }
      onAccount(status.signedIn ? status.username || 'Pollinations account' : '');
      setBalance(status.signedIn ? status.balance ?? null : null);
      setStep(status.signedIn ? 'signed-in' : 'signed-out');
      if (status.expired) setError('Your Pollinations sign-in has ended. Sign in again to keep using it.');
    });
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poll = async () => {
    const result = await pollinationsCheckLogin();
    if (!mounted.current) return;
    if (result.pending) {
      timer.current = setTimeout(poll, POLL_MS);
      return;
    }
    setCode(null);
    if (result.signedIn) {
      onAccount(result.username || 'Pollinations account');
      setError('');
      setStep('signed-in');
      pollinationsStatus().then((status) => mounted.current && setBalance(status.balance ?? null));
      return;
    }
    setError(result.error || 'The sign-in didn’t finish. Try again.');
    setStep('signed-out');
  };

  const start = async () => {
    setError('');
    setStep('starting');
    const result = await pollinationsStartLogin();
    if (!mounted.current) return;
    if (result.error) {
      setError(result.error);
      setStep('signed-out');
      return;
    }
    setCode(result);
    setStep('waiting');
    // Desktop opens this in the user's browser; a browser may block it after
    // the await, so the link and code also stay on screen.
    try { window.open(result.verificationUrl, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
    timer.current = setTimeout(poll, POLL_MS);
  };

  const cancel = () => {
    clearTimeout(timer.current);
    setCode(null);
    setStep('signed-out');
  };

  const signOut = async () => {
    const result = await pollinationsSignOut();
    if (!mounted.current) return;
    if (result.error) {
      setError(result.error);
      return;
    }
    onAccount('');
    setBalance(null);
    setStep('signed-out');
  };

  return (
    <div className="py-4 space-y-2">
      {dialog}
      <h4 className="text-sm font-semibold text-slate-900">Your Pollinations account</h4>
      {step === 'checking' && <p className="text-xs text-slate-600">Checking your sign-in…</p>}
      {step === 'signed-in' && (
        <>
          <p role="status" className="inline-flex items-start gap-1.5 text-xs text-emerald-600">
            <CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />
            Signed in as {account || 'your Pollinations account'}.{balance !== null && ` Pollen left for AppBlips: ${formatPollen(balance)}.`}
          </p>
          <button type="button" onClick={signOut} className={SECONDARY_BUTTON}>Sign out</button>
        </>
      )}
      {(step === 'signed-out' || step === 'starting') && (
        <>
          <p className="text-xs leading-snug text-slate-600">{page.signInHelp}</p>
          <button type="button" onClick={() => ask({ site: 'Pollinations', url: 'https://enter.pollinations.ai', why: 'To sign in to your Pollinations account and approve AppBlips. Pollinations hosts the sign-in, so AppBlips never sees your password.' }, start)} disabled={step === 'starting'} className={PRIMARY_BUTTON}>
            {step === 'starting' ? 'Starting…' : 'Sign in with Pollinations'}
          </button>
        </>
      )}
      {step === 'waiting' && code && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs leading-snug text-slate-800">
            Approve AppBlips on the Pollinations page that opened in your browser. If no page opened,{' '}
            <ConfirmedLink href={code.verificationUrl} site="Pollinations" why="To approve AppBlips on your Pollinations account." className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
              open it here<ExternalLink size={11} aria-hidden="true" />
            </ConfirmedLink>.
          </p>
          <p className="text-xs text-slate-800">
            If Pollinations asks for a code, enter: <span className="select-all font-mono text-sm font-bold tracking-wider">{code.userCode}</span>
          </p>
          <p role="status" className="text-xs text-slate-600">Waiting for you to approve…</p>
          <button type="button" onClick={cancel} className={SECONDARY_BUTTON}>Cancel</button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-flex items-start gap-1.5 text-xs text-red-600">
          <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{error}
        </p>
      )}
    </div>
  );
}

function SiteKey({ state, onChange }) {
  const key = state.siteKey.trim();
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const formatBad = key !== '' && !SITE_KEY_RE.test(key);

  const runCheck = async () => {
    setChecking(true);
    const result = await checkSiteKey(key);
    setChecking(false);
    setCheck(result);
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-xs leading-snug text-amber-900 dark:text-amber-200">
        <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />
        <p>
          This key has to be inside your sites so visitors’ browsers can use it. AppBlips scrambles it so it isn’t in plain
          sight, but <strong>this is not foolproof</strong>: anyone with a little know-how can find it and spend its Pollen.
          Use a key made only for this, with a small budget, so the most you can lose is that budget.
        </p>
      </div>
      <details className="text-xs leading-snug text-slate-700">
        <summary className="cursor-pointer font-semibold text-indigo-600">How to make a safe key</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Go to{' '}
            <ConfirmedLink href="https://enter.pollinations.ai/keys" why="To sign in to Pollinations and create a key with a spending limit. Keys can only be made on their website." className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
              enter.pollinations.ai/keys<ExternalLink size={11} aria-hidden="true" />
            </ConfirmedLink>{' '}
            and sign in.
          </li>
          <li>Create a new secret key. Name it something like “My AppBlips sites”.</li>
          <li>Set a small Pollen budget, for example 2. AppBlips won’t accept a key without one.</li>
          <li>Allow only the models your sites need: text for chat features, and image if visitors make pictures.</li>
          <li>Set an end date if you can, so a leaked key stops working on its own.</li>
          <li>Leave every account permission off.</li>
          <li>Copy the key (it starts with sk_) and paste it below.</li>
        </ol>
        <p className="mt-2">To stop it at any time, delete the key on the same page. The AI features in your sites then show “AI features are unavailable right now.”</p>
      </details>
      <label htmlFor="set-pollinations-site-key" className="block text-sm font-semibold text-slate-900">Site key</label>
      {!state.siteKeyAccepted && (
        <p className="text-xs text-slate-600">Until you add a key, the AI won’t build AI features.</p>
      )}
      <div className="flex gap-2">
        <input
          id="set-pollinations-site-key"
          type="text"
          value={state.siteKey}
          onChange={(event) => {
            setCheck(null);
            onChange({ siteKey: event.target.value, siteKeyAccepted: false });
          }}
          placeholder="sk_…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={formatBad}
          className={`${FIELD_CLASS} font-mono`}
        />
        <button type="button" onClick={runCheck} disabled={!key || formatBad || checking || state.siteKeyAccepted} className={SECONDARY_BUTTON}>
          {checking ? 'Checking…' : 'Check key'}
        </button>
      </div>
      {formatBad && <p role="alert" className="text-xs text-red-600">That doesn’t look like a Pollinations secret key. It starts with sk_.</p>}
      {check && !check.ok && (
        <p role="alert" className="inline-flex items-start gap-1.5 text-xs text-red-600">
          <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{check.error}
        </p>
      )}
      {check?.ok && !state.siteKeyAccepted && (
        <div className="space-y-2">
          <p className="text-xs text-slate-700">
            Key checked: {formatPollen(check.budget)} left{check.expiresAt ? `, ends ${new Date(check.expiresAt).toLocaleDateString()}` : ''}.
          </p>
          {check.warnings.map((warning) => (
            <p key={warning} className="inline-flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{warning}
            </p>
          ))}
          <label className="flex items-start gap-2 text-xs text-slate-800">
            <input type="checkbox" className="mt-0.5" onChange={(event) => event.target.checked && onChange({ siteKeyAccepted: true })} />
            I understand that anyone can find this key in my sites and spend its Pollen.
          </label>
        </div>
      )}
      {state.siteKeyAccepted && key && (
        <div className="space-y-2">
          <p role="status" className="inline-flex items-start gap-1.5 text-xs text-emerald-600">
            <CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />
            Your sites will use this key for AI features in the preview and in anything you publish or export from now on.
          </p>
          <button type="button" onClick={() => onChange({ siteKey: '', siteKeyAccepted: false })} className={SECONDARY_BUTTON}>
            Remove key
          </button>
        </div>
      )}
    </div>
  );
}

// Who pays for AI features in the user's sites; the AI builds them to match
// (getActiveConnectors → the Pollinations directive in prompts.js).
const PAYERS = [
  {
    value: 'visitors',
    label: 'Visitors use their own Pollen (safer)',
    help: 'AI features show a “Connect Pollinations” button. Each visitor signs in with their own Pollinations account and pays with their own Pollen. Nothing secret goes into your sites.',
  },
  {
    value: 'site',
    label: 'My key pays (the key goes in my sites’ code)',
    help: 'Visitors use AI features without an account, and your site key pays. All your sites share the key and its budget.',
  },
];

function AiPayer({ state, onChange }) {
  return (
    <fieldset className="py-4 space-y-3">
      <legend className="text-sm font-semibold text-slate-900">AI features in your sites</legend>
      <p className="text-xs leading-snug text-slate-600">
        Choose who pays when visitors use AI features, such as a chatbot, in the sites you build. The AI builds them to match.
        Sites you built earlier change when you publish or export them again.
      </p>
      {PAYERS.map(({ value, label, help }) => (
        <label key={value} className="flex items-start gap-2 text-sm text-slate-900">
          <input
            type="radio"
            name="pollinations-ai-payer"
            className="mt-1"
            checked={state.aiPayer === value}
            onChange={() => onChange({ aiPayer: value })}
          />
          <span>
            <span className="block font-semibold">{label}</span>
            <span className="block text-xs leading-snug text-slate-600">{help}</span>
          </span>
        </label>
      ))}
      {state.aiPayer === 'site' && <SiteKey state={state} onChange={onChange} />}
    </fieldset>
  );
}

// Sign-in comes first: the switch won't turn on until there is an account
// (clicking it says why), and losing the account (sign-out, expiry) turns it
// off again, so the AI is never told to use Pollinations without a sign-in.
export default function PollinationsConnector({ state, onChange }) {
  const { page } = CONNECTOR_DEFINITIONS.pollinations;
  const signedIn = Boolean(state.account);
  const [blocked, setBlocked] = useState(false);
  return (
    <>
      <SignIn
        account={state.account}
        onAccount={(account) => {
          if (account) setBlocked(false);
          onChange(account ? { account } : { account, enabled: false });
        }}
      />
      <SettingRow
        id="set-pollinations"
        title="Enable Pollinations"
        description={page.enableDescription}
      >
        <Switch
          checked={state.enabled && signedIn}
          onChange={(enabled) => {
            if (enabled && !signedIn) {
              setBlocked(true);
              return;
            }
            onChange({ enabled });
          }}
          labelledBy="set-pollinations"
        />
      </SettingRow>
      {blocked && !signedIn && <p role="alert" className="pb-3 text-xs text-red-600">{page.needsSignIn}</p>}
      {POLLINATIONS_EARNINGS && <p className="pb-3 text-xs leading-snug text-slate-600">{POLLINATIONS_FEE_NOTE}</p>}
      {state.enabled && signedIn && (
        <>
          <p role="status" className="inline-flex items-start gap-1.5 pt-3 text-xs text-emerald-600">
            <CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />{page.connected}
          </p>
          <AiPayer state={state} onChange={onChange} />
        </>
      )}
    </>
  );
}
