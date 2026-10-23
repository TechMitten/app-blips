import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Copy, ExternalLink, Globe, Loader2, RefreshCw, Share2, Trash2 } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import {
  SURGE_SUFFIX, loadPublishedName, savePublishedName, suggestSurgeName,
  surgeLogin, surgePublish, surgeSignOut, surgeStatus, surgeUnpublish,
} from '../lib/surge';
import { shareLinks } from '../lib/share';
import ShareIcon from './ShareIcons';

const LABEL_CLASS = 'block text-sm font-semibold text-slate-900';
const LINK_CLASS = 'font-semibold text-indigo-600 hover:underline';

// Publish: puts the current pages on Surge (surge.sh) at a free
// <name>.surge.sh address with HTTPS. The first time it asks for a Surge sign-in
// (a new email creates the account); the server keeps the token
// (lib/surge.js). `buildFiles` returns the same pages Export downloads.
// A project that is already online opens on 'manage' instead: update the
// site, unpublish it, or publish to a different address.
export default function PublishDialog({ projectId, projectName, buildFiles, onClose }) {
  // loading | signin | manage | unpublish | removed | ready | publishing | done
  const [step, setStep] = useState('loading');
  // The address this project is live at (without .surge.sh), or ''.
  const [published, setPublished] = useState(() => loadPublishedName(projectId));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // New users pick "Create an account", which asks for the password twice so
  // a typo doesn't lock them out of the account it creates.
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [account, setAccount] = useState('');
  const [name, setName] = useState(() => suggestSurgeName(projectName));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const signedInStep = published ? 'manage' : 'ready';

  useEffect(() => {
    mounted.current = true;
    surgeStatus().then((status) => {
      if (!mounted.current) return;
      if (status.signedIn) {
        setAccount(status.email);
        setStep(signedInStep);
      } else {
        setStep('signin');
      }
    });
    return () => { mounted.current = false; };
    // Only on open: later steps are chosen by the actions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || busy) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, busy]);

  const signIn = async (event) => {
    event.preventDefault();
    if (creating && password !== confirm) {
      setError('The passwords don’t match. Type the same password in both boxes.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await surgeLogin(email.trim(), password);
    if (!mounted.current) return;
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPassword('');
    setConfirm('');
    setAccount(result.email);
    setStep(signedInStep);
  };

  const signOut = async () => {
    await surgeSignOut();
    if (!mounted.current) return;
    setAccount('');
    setError('');
    setStep('signin');
  };

  // From 'ready' (a new address) or 'manage' (Update site, same address); a
  // failure goes back to where it started.
  const publishTo = async (target, from) => {
    const clean = target.trim().toLowerCase();
    setBusy(true);
    setError('');
    if (from === 'ready') setStep('publishing');
    const result = await surgePublish(clean, buildFiles());
    if (!mounted.current) return;
    setBusy(false);
    if (result.error) {
      setError(result.error);
      setStep(result.signedOut ? 'signin' : from);
      return;
    }
    savePublishedName(projectId, clean);
    setPublished(clean);
    setUrl(result.url);
    setStep('done');
  };

  const publish = (event) => {
    event.preventDefault();
    publishTo(name, 'ready');
  };

  const unpublish = async () => {
    setBusy(true);
    setError('');
    const result = await surgeUnpublish(published);
    if (!mounted.current) return;
    setBusy(false);
    if (result.error) {
      setError(result.error);
      setStep(result.signedOut ? 'signin' : 'manage');
      return;
    }
    savePublishedName(projectId, '');
    setStep('removed');
  };

  const publishedUrl = published ? `https://${published}${SURGE_SUFFIX}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => mounted.current && setCopied(false), 1500);
    } catch { /* clipboard blocked: the link is still on screen */ }
  };

  const errorLine = error && (
    <p role="alert" className="flex items-start gap-2 text-xs leading-snug text-red-600">
      <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{error}
    </p>
  );

  return (
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh]"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'publish-title' }}
    >
      <div className="shrink-0 px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 id="publish-title" className="flex items-center gap-2 text-base 2xl:text-lg font-semibold text-slate-900">
          <Globe size={18} aria-hidden="true" />
          Publish to the web
        </h2>
        <ModalCloseButton onClick={onClose} disabled={busy} />
      </div>

      {step === 'loading' && (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />Loading…
        </div>
      )}

      {step === 'signin' && (
        <form onSubmit={signIn} className="flex min-h-0 flex-col">
          <div className="p-6 space-y-4 overflow-y-auto text-sm text-slate-700">
            <p className="text-xs leading-snug text-slate-600">
              AppBlips publishes with <a href="https://surge.sh" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>Surge</a>,
              free hosting that gives your site its own web address with HTTPS.
              {creating
                ? ' Type your email and choose a password for your free Surge account.'
                : ' Sign in with your Surge account.'}
            </p>
            <div className="flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Surge account">
              {[[false, 'I have an account'], [true, 'Create an account']].map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setCreating(value); setConfirm(''); setError(''); }}
                  aria-pressed={creating === value}
                  disabled={busy}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    creating === value ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="surge-email" className={LABEL_CLASS}>Email</label>
              <input
                id="surge-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                autoFocus
                required
                className={FIELD_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="surge-password" className={LABEL_CLASS}>Password</label>
              <input
                id="surge-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={creating ? 'new-password' : 'current-password'}
                required
                className={FIELD_CLASS}
              />
            </div>
            {creating && (
              <div className="space-y-1.5">
                <label htmlFor="surge-confirm" className={LABEL_CLASS}>Type the password again</label>
                <input
                  id="surge-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  required
                  className={FIELD_CLASS}
                />
              </div>
            )}
            {errorLine}
            <p className="text-xs leading-snug text-slate-500">
              Your password goes to Surge once and isn&rsquo;t saved. AppBlips keeps only the sign-in Surge sends back, on this computer.
              By signing in you agree to <a href="https://surge.sh/terms" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>Surge&rsquo;s terms</a>.
            </p>
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-3">
            <button type="button" onClick={onClose} disabled={busy} className={SECONDARY_BUTTON}>Cancel</button>
            <button type="submit" disabled={busy || !email.trim() || !password || (creating && !confirm)} className={PRIMARY_BUTTON}>
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {creating ? 'Create account' : 'Sign in'}
            </button>
          </div>
        </form>
      )}

      {step === 'manage' && (
        <>
          <div className="p-6 space-y-4 text-sm text-slate-700">
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 font-semibold text-emerald-600">
                <Check size={18} aria-hidden="true" />This project is online
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <a href={publishedUrl} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate ${LINK_CLASS}`}>{publishedUrl}</a>
                <ExternalLink size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
              </div>
            </div>
            <p className="text-xs leading-snug text-slate-600">
              <strong className="text-slate-800">Update site</strong> replaces what&rsquo;s online with your latest version.{' '}
              <strong className="text-slate-800">Unpublish</strong> takes it offline.
            </p>
            {errorLine}
            <p className="text-xs leading-snug text-slate-500">
              <button
                type="button"
                onClick={() => { setError(''); setStep('ready'); }}
                disabled={busy}
                className={LINK_CLASS}
              >
                Publish to a different address
              </button>
              {' · '}Signed in as <strong className="text-slate-700">{account}</strong>.{' '}
              <button type="button" onClick={signOut} disabled={busy} className={LINK_CLASS}>Sign out</button>
            </p>
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { setError(''); setStep('unpublish'); }}
              disabled={busy}
              className={`${SECONDARY_BUTTON} text-red-600 hover:text-red-700`}
            >
              <Trash2 size={14} aria-hidden="true" />Unpublish
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={busy} className={SECONDARY_BUTTON}>Cancel</button>
              <button type="button" onClick={() => publishTo(published, 'manage')} disabled={busy} autoFocus className={PRIMARY_BUTTON}>
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                {busy ? 'Updating…' : 'Update site'}
              </button>
            </div>
          </div>
        </>
      )}

      {step === 'unpublish' && (
        <>
          <div className="p-6 space-y-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Unpublish {published}{SURGE_SUFFIX}?</p>
            <p className="text-xs leading-snug text-slate-600">
              The site goes offline right away and the link stops working. Your project stays in AppBlips, so you can publish it again later.
              Someone else could take this address in the meantime.
            </p>
            {errorLine}
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-3">
            <button type="button" onClick={() => setStep('manage')} disabled={busy} autoFocus className={SECONDARY_BUTTON}>Keep it online</button>
            <button
              type="button"
              onClick={unpublish}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2 bg-red-600 text-white font-semibold text-sm hover:bg-red-700 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
              {busy ? 'Unpublishing…' : 'Unpublish'}
            </button>
          </div>
        </>
      )}

      {step === 'removed' && (
        <>
          <div className="p-6 space-y-2 text-sm text-slate-700">
            <p role="status" className="flex items-center gap-2 font-semibold text-slate-900">
              <Check size={18} aria-hidden="true" />{published}{SURGE_SUFFIX} is offline
            </p>
            <p className="text-xs leading-snug text-slate-600">It can take a minute for the old version to disappear everywhere.</p>
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setName(published); setPublished(''); setStep('ready'); }}
              className={SECONDARY_BUTTON}
            >
              Publish again
            </button>
            <button type="button" onClick={onClose} autoFocus className={PRIMARY_BUTTON}>Done</button>
          </div>
        </>
      )}

      {(step === 'ready' || step === 'publishing') && (
        <form onSubmit={publish} className="flex min-h-0 flex-col">
          <div className="p-6 space-y-4 overflow-y-auto text-sm text-slate-700">
            <div className="space-y-1.5">
              <label htmlFor="surge-name" className={LABEL_CLASS}>Web address</label>
              <div className="flex items-center rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-indigo-500">
                <span className="pl-3 text-sm text-slate-500" aria-hidden="true">https://</span>
                <input
                  id="surge-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  maxLength={63}
                  autoFocus
                  spellCheck={false}
                  disabled={busy}
                  aria-describedby="surge-name-help"
                  className="min-w-0 flex-1 bg-transparent px-0.5 py-2 text-sm font-semibold text-slate-900 outline-none"
                />
                <span className="pr-3 text-sm text-slate-500">{SURGE_SUFFIX}</span>
              </div>
              <p id="surge-name-help" className="text-xs leading-snug text-slate-500">
                {published
                  ? `This makes a second copy. ${published}${SURGE_SUFFIX} stays online until you unpublish it.`
                  : 'Letters, numbers and dashes. If someone else already uses the name, pick another.'}
              </p>
            </div>
            {errorLine}
            <p className="text-xs leading-snug text-slate-500">
              Anyone with the link can see your site. Signed in to Surge as <strong className="text-slate-700">{account}</strong>.{' '}
              <button type="button" onClick={signOut} disabled={busy} className={LINK_CLASS}>Sign out</button>
            </p>
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-3">
            <button type="button" onClick={published ? () => { setError(''); setStep('manage'); } : onClose} disabled={busy} className={SECONDARY_BUTTON}>
              {published ? 'Back' : 'Cancel'}
            </button>
            <button type="submit" disabled={busy || !name} className={PRIMARY_BUTTON}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Globe size={16} aria-hidden="true" />}
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <>
          <div className="p-6 space-y-3 text-sm text-slate-700">
            <p role="status" className="flex items-center gap-2 font-semibold text-emerald-600">
              <Check size={18} aria-hidden="true" />Your site is live
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className={`min-w-0 flex-1 truncate ${LINK_CLASS}`}>{url}</a>
              <button type="button" onClick={copy} className={SECONDARY_BUTTON} aria-label="Copy link">
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Share2 size={13} aria-hidden="true" />Share it
              </p>
              <div className="flex flex-wrap gap-2">
                {shareLinks(url, projectName).map(({ id, label, href }) => (
                  <a
                    key={id}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={id === 'email' ? 'Share by email' : `Share on ${label}`}
                    title={id === 'email' ? 'Email' : label}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  >
                    <ShareIcon id={id} />
                  </a>
                ))}
              </div>
            </div>
            <p className="text-xs leading-snug text-slate-500">
              It can take a minute to appear everywhere. After you make changes, click Publish again to update it.
            </p>
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-3">
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>Close</button>
            <a href={url} target="_blank" rel="noopener noreferrer" className={PRIMARY_BUTTON}>
              <ExternalLink size={16} aria-hidden="true" />Open site
            </a>
          </div>
        </>
      )}
    </Modal>
  );
}
