import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, ExternalLink, Sparkles } from 'lucide-react';
import CodeInput from './CodeInput';
import { CODE_LENGTH, codeValue, isCodeComplete } from '../lib/signInCode';
import { SettingRow, FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import { ipcErrorMessage, providerApi } from '../lib/desktop';
import { creditsStatus, creditsConnect, creditsVerify, creditsCheckout, creditsSignOut, CREDIT_PACKS, FREE_TRIAL_PACK } from '../lib/credits';
import { logError } from '../lib/errorLog';

// Settings → Account: AppBlips AI Credits (src/lib/credits.js). A provider
// saved under Settings → API takes over from credits, so this tab reads the
// saved provider too, to say credits are paused and offer to switch back.

// Polar's own customer portal: usage stats and subscription cancelling live
// there, so we link out instead of cancelling from the app.
const POLAR_PORTAL_URL = 'https://polar.sh/techmitten-llc/portal';

function AppBlipsCreditsRow({ byokActive, onClearByok }) {
  const [info, setInfo] = useState(null); // { signedIn, email, remaining, totalGranted, totalUsed }
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'sending' | 'connecting' | 'checking' | packId
  const [waitingPack, setWaitingPack] = useState(null);
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'error', text }
  // The email a sign-in code went to; connecting needs that code, so knowing
  // a customer's email isn't enough to spend their credits.
  const [codeSentTo, setCodeSentTo] = useState('');
  const [code, setCode] = useState('');
  const mounted = useRef(true);

  const loadStatus = async (silent = false) => {
    if (!silent) setBusy('checking');
    const res = await creditsStatus();
    if (!mounted.current) return;
    if (!silent) setBusy('');
    if (!res.error) {
      setInfo(res);
      if (res.email && !email) setEmail(res.email);
    }
  };

  useEffect(() => {
    mounted.current = true;
    loadStatus(true);
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = (res) => {
    setWaitingPack(null);
    setCodeSentTo('');
    setCode('');
    setInfo(res);
    setMessage({ kind: 'ok', text: `Connected! ${typeof res.remaining === 'number' ? `${res.remaining.toLocaleString()} AI Credits ready.` : 'Ready to build.'}` });
  };

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage({ kind: 'error', text: 'Enter the email address you used at checkout.' });
      return;
    }
    setBusy('sending');
    setMessage(null);
    const res = await creditsConnect(trimmed);
    if (!mounted.current) return;
    setBusy('');
    if (res.error) {
      setMessage({ kind: 'error', text: res.error });
      return;
    }
    if (res.signedIn) return connected(res);
    setCode('');
    setCodeSentTo(res.email || trimmed);
    setMessage({ kind: 'ok', text: `We sent a sign-in code to ${res.email || trimmed}. It comes from Polar, our payment service.` });
  };

  const verifyCode = async () => {
    if (!isCodeComplete(code)) {
      setMessage({ kind: 'error', text: `Enter all ${CODE_LENGTH} characters of the code from the email.` });
      return;
    }
    setBusy('connecting');
    setMessage(null);
    const res = await creditsVerify(codeSentTo, codeValue(code));
    if (!mounted.current) return;
    setBusy('');
    if (res.error) {
      setMessage({ kind: 'error', text: res.error });
      return;
    }
    connected(res);
  };

  const startPackCheckout = async (pack) => {
    setMessage(null);
    setBusy(pack.id);
    const res = await creditsCheckout(pack.id, email.trim());
    if (!mounted.current) return;
    setBusy('');
    if (res.error || !res.checkoutUrl) {
      setMessage({ kind: 'error', text: res.error || 'Could not open checkout.' });
      return;
    }
    try { window.open(res.checkoutUrl, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
    setWaitingPack(pack);
  };

  const signOut = async () => {
    setWaitingPack(null);
    const res = await creditsSignOut();
    if (!mounted.current) return;
    setInfo(res);
    setMessage(null);
  };

  const signedIn = Boolean(info?.signedIn);
  const creditsSummary = !info
    ? 'Checking your AppBlips Credits…'
    : signedIn
      ? `Connected as ${info.email}${typeof info.remaining === 'number' ? ` · ${info.remaining.toLocaleString()} AI Credits remaining` : ''}.${byokActive ? ' (Paused while your own provider in the API tab is active.)' : ' Active for all builds.'}`
      : 'Build without an API key. Buy a pay-as-you-go credit pack or connect with your checkout email.';

  return (
    <SettingRow
      id="set-appblips-credits"
      title="AppBlips AI Credits (No API key required)"
      description={creditsSummary}
      details={(
        <div className="space-y-3">
          {signedIn ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <CircleCheck size={14} className="shrink-0" />
                  Connected as {info.email}
                </span>
                {typeof info.remaining === 'number' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                    <Sparkles size={12} />
                    {info.remaining.toLocaleString()} Credits left
                  </span>
                )}
              </div>
              {typeof info.totalGranted === 'number' && (
                <p className="text-xs text-slate-500">
                  Used {(info.totalUsed || 0).toLocaleString()} of {info.totalGranted.toLocaleString()} total credits.
                  {info.trialActive && info.trialExpiresAt
                    ? ` 3-day free trial active until ${new Date(info.trialExpiresAt).toLocaleDateString()}, then $10/month for 1,000 credits a month unless you cancel.`
                    : info.trialExpired && !info.remaining
                      ? ' Your 3-day free trial has expired — buy a credit pack below to continue.'
                      : ' Paid credits never expire.'}
                </p>
              )}
              {byokActive && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <span>Your own provider in the API tab is currently overriding AppBlips Credits.</span>
                  <button type="button" onClick={onClearByok} className={SECONDARY_BUTTON}>
                    Use AppBlips Credits instead
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={() => loadStatus(false)} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                  {busy === 'checking' ? 'Refreshing…' : 'Refresh balance'}
                </button>
                <button type="button" onClick={signOut} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                  Disconnect
                </button>
                <a href={POLAR_PORTAL_URL} target="_blank" rel="noopener noreferrer" className={SECONDARY_BUTTON}>
                  Cancel subscription <ExternalLink size={12} />
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {codeSentTo ? (
                <>
                  <div className="text-sm text-slate-600">
                    Code from the email sent to {codeSentTo}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) verifyCode(); }}>
                      <CodeInput
                        value={code}
                        onChange={(next) => { setCode(next); setMessage(null); }}
                        label="Code from the email"
                        disabled={Boolean(busy)}
                        className="flex gap-1.5"
                        boxClassName="h-10 w-10 rounded-lg border border-slate-300 bg-surface text-center font-mono text-base font-semibold uppercase text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-400/30 disabled:opacity-60"
                        autoFocus
                      />
                      <button type="button" onClick={verifyCode} disabled={Boolean(busy) || !isCodeComplete(code)} className={`${PRIMARY_BUTTON} shrink-0`}>
                        {busy === 'connecting' ? 'Connecting…' : 'Connect Credits'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={sendCode} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                      {busy === 'sending' ? 'Sending…' : 'Send a new code'}
                    </button>
                    <button type="button" onClick={() => { setCodeSentTo(''); setCode(''); setMessage(null); }} disabled={Boolean(busy)} className={SECONDARY_BUTTON}>
                      Use a different email
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-sm text-slate-600">
                    Checkout email
                    <div className="mt-1.5 flex flex-wrap sm:flex-nowrap gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setMessage(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) sendCode(); }}
                        placeholder="you@example.com (email used at checkout)"
                        className={FIELD_CLASS}
                      />
                      <button type="button" onClick={sendCode} disabled={Boolean(busy) || !email.trim()} className={`${PRIMARY_BUTTON} shrink-0`}>
                        {busy === 'sending' ? 'Sending…' : 'Email me a code'}
                      </button>
                    </div>
                  </label>
                  <p className="text-xs text-slate-500 leading-snug">
                    Already bought a credit pack? Enter the email you used at checkout and we'll email you a code to connect. Need credits? Pick a pack below:
                  </p>
                </>
              )}
            </div>
          )}

          {!signedIn && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                  <Sparkles size={13} />
                  {FREE_TRIAL_PACK.name} ($0)
                </span>
                <p className="text-xs text-emerald-700">
                  {FREE_TRIAL_PACK.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startPackCheckout(FREE_TRIAL_PACK)}
                disabled={Boolean(busy)}
                className={PRIMARY_BUTTON}
              >
                {busy === FREE_TRIAL_PACK.id ? 'Starting…' : <>Start 3-Day Free Trial <ExternalLink size={12} /></>}
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {signedIn ? 'Top up AI Credits (One-time · Never expires)' : 'Buy AI Credits (One-time · Never expires)'}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {CREDIT_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => startPackCheckout(pack)}
                  disabled={Boolean(busy)}
                  className="rounded-xl border border-slate-200 hover:border-slate-400 bg-surface p-3 text-left transition-colors flex flex-col justify-between gap-1"
                >
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span className="text-xs font-bold text-slate-900">{pack.shortName}</span>
                    <span className="text-xs font-extrabold text-indigo-600">${pack.priceUsd}</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-700">
                    {pack.credits.toLocaleString()} Credits
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                    {busy === pack.id ? 'Opening…' : <>Buy pack <ExternalLink size={10} /></>}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {waitingPack && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">
                Complete your {waitingPack.shortName} (${waitingPack.priceUsd}) purchase in the browser tab that opened.
              </p>
              <p>
                {signedIn
                  ? <>Once finished, click <strong>Refresh balance</strong>.</>
                  : <>Once finished, enter your checkout email above and click <strong>Email me a code</strong>.</>}
              </p>
            </div>
          )}

          {message && (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={`inline-flex items-center gap-1.5 text-xs ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-600'}`}
            >
              {message.kind === 'ok' ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
              {message.text}
            </p>
          )}
        </div>
      )}
    />
  );
}


export default function CreditsSettings() {
  const [byokActive, setByokActive] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    providerApi.get().then((saved) => {
      setByokActive(Boolean(saved?.enabled && saved.id && saved.model && (saved.local || saved.hasKey)));
    }).catch((err) => logError('Could not read the AI settings', err));
  }, []);

  const onClearByok = async () => {
    setError(null);
    try {
      await providerApi.clear();
      setByokActive(false);
    } catch (err) {
      logError('Could not clear the AI provider settings', err);
      setError(ipcErrorMessage(err) || 'Could not switch to AppBlips Credits.');
    }
  };

  return (
    <>
      <AppBlipsCreditsRow byokActive={byokActive} onClearByok={onClearByok} />
      <p className="pt-4 text-xs text-slate-600">
        Have questions about your account? Email{' '}
        <a href="mailto:support@appblips.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-900 underline">support@appblips.com</a>.
      </p>
      {error && (
        <p role="alert" className="inline-flex items-center gap-1.5 text-xs text-red-600">
          <CircleAlert size={14} />
          {error}
        </p>
      )}
    </>
  );
}
