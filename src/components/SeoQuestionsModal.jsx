import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, ClipboardCheck, Globe, Pencil, Search, Send, Share2, Store, Users, X,
} from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { Switch, FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import {
  MAX_SEO_KEYWORDS, SEO_SITE_TYPES, SEO_STEPS, emptySeoForm, hashSeoForm, isSeoComplete, normalizeSeoForm, seoOrigin, seoPending,
} from '../lib/seo';
import { scanSite } from '../lib/seoScan';

// The SEO questions, in their own dialog opened from Settings → Tools →
// SEO (SeoConnector.jsx). A few questions a page (the steps are data: lib/seo.js
// SEO_STEPS), ending on a review page with the only Save. Answers are a draft
// until then. Saving stores them with the project (App.jsx handleSaveSeo); the
// AI hears about them once, with the next request, or right away through
// "Apply to my site now". Sits above the Settings modal like ConnectorInfoModal.
const REVIEW = SEO_STEPS.length;

// Looks only: an icon and a short stepper label per step id in SEO_STEPS.
const STEP_META = {
  site: { Icon: Store, short: 'Basics' },
  audience: { Icon: Users, short: 'Audience' },
  found: { Icon: Search, short: 'Search' },
  share: { Icon: Share2, short: 'Sharing' },
};
const REVIEW_META = { Icon: ClipboardCheck, short: 'Review' };
const metaFor = (index) => (index < REVIEW ? STEP_META[SEO_STEPS[index].id] : REVIEW_META);

const LINK_BUTTON = 'text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline disabled:opacity-40 disabled:no-underline';
const GHOST_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40';
const INPUT_CLASS = `${FIELD_CLASS} transition-[border-color,box-shadow] focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20`;
const ICON_TILE = 'flex shrink-0 items-center justify-center text-slate-500';

// Small notes under a field: a quiet one, or a warning that something typed
// will be left out when saved.
function FieldNote({ tone = 'muted', children }) {
  const Icon = tone === 'warn' ? CircleAlert : CircleCheck;
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 text-xs leading-snug ${tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500'}`}>
      <Icon size={13} className="mt-px shrink-0" aria-hidden="true" />{children}
    </p>
  );
}

function Counter({ length, max }) {
  // Only once it's worth knowing, so short answers stay uncluttered.
  if (!max || length < max * 0.7) return null;
  return (
    <span className={`text-[11px] tabular-nums ${length >= max ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>
      {length}/{max}
    </span>
  );
}

function ChipsField({ id, field, value, onChange, describedBy }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const add = (raw = text) => {
    const word = raw.trim().replace(/,+$/, '').trim();
    setText('');
    if (word) onChange(normalizeSeoForm({ keywords: [...value, word] }).keywords);
  };
  const full = value.length >= MAX_SEO_KEYWORDS;
  return (
    <div>
      {/* One box that looks like a field, with the phrases inside it. Clicking
          anywhere in it types into the input. */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[2.625rem] w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-500/20"
      >
        {value.map((word) => (
          <span key={word} className="inline-flex items-center gap-1 rounded-md bg-red-500/10 py-1 pl-2 pr-1 text-xs font-medium text-slate-700">
            {word}
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onChange(value.filter((item) => item !== word)); }}
              aria-label={`Remove ${word}`}
              className="rounded p-0.5 transition-colors hover:bg-red-500/20"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={text}
          disabled={full}
          maxLength={field.max}
          placeholder={full ? 'That’s the most you can add' : value.length ? 'Add another…' : field.placeholder}
          aria-describedby={describedBy}
          onChange={(event) => (event.target.value.endsWith(',') ? add(event.target.value) : setText(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Enter adds the phrase here; it never moves on by accident.
              event.preventDefault();
              event.stopPropagation();
              add();
            } else if (event.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => add()}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{text.trim() ? <>Press <kbd className="rounded border border-slate-300 px-1 font-sans text-[11px]">Enter</kbd> to add it</> : ''}</span>
        <span className="tabular-nums">{value.length} of {MAX_SEO_KEYWORDS}</span>
      </div>
    </div>
  );
}

// The site-type choice: a radio group of pills, arrow keys move between them.
function ChoiceField({ id, field, value, onChange }) {
  const refs = useRef([]);
  const selected = Math.max(0, field.options.findIndex((option) => option.id === value));
  const move = (event, index) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + field.options.length) % field.options.length;
    onChange(field.options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
      {field.options.map((option, index) => {
        const on = value === option.id;
        return (
          <button
            key={option.id}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => move(event, index)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 ${
              on
                ? 'border-red-500 bg-red-500/10 text-slate-700'
                : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-100'
            }`}
          >
            {on && <Check size={14} aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ field, form, onChange, images, onEnter, className = '' }) {
  const id = `seo-${field.key}`;
  const describedBy = field.hint ? `${id}-hint` : undefined;
  const value = form[field.key];
  // Notes about what will be left out wait until the person leaves the field,
  // so they don't nag mid-typing.
  const [touched, setTouched] = useState(false);
  let control;
  let note = null;
  if (field.type === 'toggle') {
    return (
      <div className={`flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3.5 ${className}`}>
        <div>
          <span id={id} className="block text-sm font-semibold text-slate-900">{field.label}</span>
          <p id={describedBy} className="mt-0.5 text-xs leading-snug text-slate-600">{field.hint}</p>
        </div>
        <Switch checked={value} onChange={(next) => onChange(field.key, next)} labelledBy={id} />
      </div>
    );
  }
  if (field.type === 'choice') {
    control = <ChoiceField id={id} field={field} value={value} onChange={(next) => onChange(field.key, next)} />;
  } else if (field.type === 'chips') {
    control = <ChipsField id={id} field={field} value={value} onChange={(next) => onChange(field.key, next)} describedBy={describedBy} />;
  } else if (field.type === 'image') {
    control = images.length ? (
      <select
        id={id}
        value={value}
        aria-describedby={describedBy}
        onChange={(event) => onChange(field.key, event.target.value)}
        className={INPUT_CLASS}
      >
        <option value="">No picture</option>
        {images.map((image) => <option key={image.hash} value={image.name}>{image.name}</option>)}
      </select>
    ) : (
      <p id={id} className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs leading-snug text-slate-600">
        You haven’t uploaded any images yet. Add some in Settings → Tools → My images, then come back to pick one.
      </p>
    );
  } else if (field.type === 'textarea' || field.type === 'lines') {
    const lines = field.type === 'lines';
    control = (
      <textarea
        id={id}
        rows={3}
        value={lines ? value.join('\n') : value}
        maxLength={lines ? undefined : field.max}
        placeholder={field.placeholder}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        onChange={(event) => onChange(field.key, lines ? event.target.value.split('\n') : event.target.value)}
        onBlur={() => setTouched(true)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onEnter(); }}
        spellCheck={!lines}
        className={`${INPUT_CLASS} resize-none`}
      />
    );
    if (lines && touched) {
      const skipped = value.filter((line) => line.trim() && !normalizeSeoForm({ social: [line] }).social.length).length;
      if (skipped) note = <FieldNote tone="warn">{skipped === 1 ? '1 line isn’t' : `${skipped} lines aren’t`} a full https:// link, so {skipped === 1 ? 'it' : 'they'} will be left out.</FieldNote>;
    }
  } else {
    const url = field.type === 'url';
    control = (
      <input
        id={id}
        type={url ? 'url' : 'text'}
        value={value}
        maxLength={field.max}
        placeholder={field.placeholder}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        autoComplete="off"
        spellCheck={!url}
        onChange={(event) => onChange(field.key, event.target.value)}
        onBlur={() => setTouched(true)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onEnter(); } }}
        className={INPUT_CLASS}
      />
    );
    if (url && touched && value.trim()) {
      const origin = seoOrigin(value);
      if (!origin) note = <FieldNote tone="warn">That doesn’t look like a web address, so it will be left out.</FieldNote>;
      else if (origin !== value.trim()) note = <FieldNote>Saved as {origin}</FieldNote>;
    }
  }
  const counted = field.type === 'text' || field.type === 'textarea';
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label id={`${id}-label`} htmlFor={field.type === 'choice' ? undefined : id} className="block text-sm font-semibold text-slate-900">
          {field.label}
        </label>
        {counted ? <Counter length={value.length} max={field.max} /> : null}
        {!field.required && !(counted && value.length >= field.max * 0.7) && (
          <span className="text-[11px] font-medium text-slate-400">Optional</span>
        )}
      </div>
      {field.hint && <p id={describedBy} className="mb-2 mt-0.5 text-xs leading-snug text-slate-600">{field.hint}</p>}
      {!field.hint && <div className="mb-2" />}
      {control}
      {note}
    </div>
  );
}

// Shown under the website address once a valid one is typed. AppBlips only
// reads the site after the person says yes, and says exactly what it reads.
// What it found is kept in the answers (form.scan) and goes to the AI.
function SiteScan({ origin, scan, declined, onScan, onDecline, className = '' }) {
  // Wait for a pause in typing, so the question doesn't flash up mid-address.
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettled(origin), 600);
    return () => clearTimeout(timer);
  }, [origin]);
  const [state, setState] = useState({ status: 'idle', message: '' });
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!origin || settled !== origin) return null;
  const host = new URL(origin).host;

  const run = async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState({ status: 'scanning', message: '' });
    const result = await scanSite(origin, abortRef.current.signal);
    if (abortRef.current.signal.aborted) return;
    if (result.scan) {
      setState({ status: 'idle', message: '' });
      onScan(result.scan);
    } else {
      setState({ status: 'error', message: result.error });
    }
  };

  const shell = `rounded-xl border border-slate-200 p-3.5 animate-fade-in motion-reduce:animate-none ${className}`;
  const scanning = state.status === 'scanning';

  if (scan && scan.origin === origin) {
    return (
      <div role="group" aria-label="What AppBlips read from your site" className={shell}>
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CircleCheck size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          Looked at {host}
        </p>
        <dl className="mt-2 space-y-1 text-xs leading-snug text-slate-600">
          {scan.title && <div><dt className="inline text-slate-500">Title: </dt><dd className="inline break-words">{scan.title}</dd></div>}
          {scan.description && <div><dt className="inline text-slate-500">Description: </dt><dd className="inline break-words">{scan.description}</dd></div>}
          {scan.headings.length > 0 && <div><dt className="inline text-slate-500">Headings: </dt><dd className="inline break-words">{scan.headings.join(' · ')}</dd></div>}
        </dl>
        <p className="mt-2 text-xs text-slate-500">The AI will use this to match your site. It is saved with your answers.</p>
        <div className="mt-2.5 flex items-center gap-1">
          <button type="button" onClick={run} disabled={scanning} className={`-ml-2 ${GHOST_BUTTON} !py-1 text-xs`}>{scanning ? 'Scanning…' : 'Scan again'}</button>
          <button type="button" onClick={() => onScan(null)} className={`${GHOST_BUTTON} !py-1 text-xs`}>Forget it</button>
        </div>
      </div>
    );
  }

  if (declined) {
    return (
      <p className={`text-xs text-slate-500 ${className}`}>
        Not scanning {host}.{' '}
        <button type="button" onClick={() => { onDecline(false); run(); }} className="font-semibold text-slate-700 hover:underline">Scan it after all</button>
      </p>
    );
  }

  return (
    <div role="group" aria-labelledby="seo-scan-title" className={shell}>
      <div className="flex items-start gap-3">
        <Globe size={18} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
        <div className="min-w-0">
          <p id="seo-scan-title" className="text-sm font-semibold text-slate-900">Is it OK to scan {host}?</p>
          <p className="mt-0.5 text-xs leading-snug text-slate-600">
            AppBlips will visit that page once, from your computer, and read its title, description and headings. The AI can then
            match what your site already says. It doesn’t keep a copy of the page or follow its links.
          </p>
          {state.status === 'error' && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-amber-700 dark:text-amber-400">
              <CircleAlert size={13} className="mt-px shrink-0" aria-hidden="true" />{state.message}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={run} disabled={scanning} className={`${PRIMARY_BUTTON} !px-4 !py-1.5`}>
              {scanning ? 'Scanning…' : state.status === 'error' ? 'Try again' : 'Yes, scan it'}
            </button>
            <button type="button" onClick={() => onDecline(true)} disabled={scanning} className={GHOST_BUTTON}>No thanks</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The step bar: one segment per page, labelled on wider screens. Pages already
// reached can be jumped back to; forward only once the required answers are in.
function Stepper({ step, reached, blocked, onGo }) {
  return (
    <ol className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${REVIEW + 1}, minmax(0, 1fr))` }}>
      {Array.from({ length: REVIEW + 1 }, (_, index) => {
        const { short } = metaFor(index);
        const done = index < step;
        const here = index === step;
        const reachable = index <= reached && !(blocked && index > step);
        return (
          <li key={short}>
            <button
              type="button"
              onClick={() => onGo(index)}
              disabled={!reachable || here}
              aria-current={here ? 'step' : undefined}
              aria-label={`${short}${done ? ', done' : ''}`}
              className="group block w-full rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-default"
            >
              <span className={`block h-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${done || here ? 'bg-red-500' : 'bg-slate-200'} ${reachable && !here ? 'group-hover:bg-red-400' : ''}`} />
              <span className={`mt-1.5 hidden truncate text-[11px] sm:block ${here ? 'font-semibold text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>
                {short}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// What a field's answer looks like on the review page.
const summaryText = (field, form) => {
  const value = form[field.key];
  if (field.type === 'toggle') return value ? 'Yes' : 'No, keep it hidden for now';
  if (field.type === 'choice') return SEO_SITE_TYPES.find((option) => option.id === value)?.label || '';
  if (field.type === 'chips' || field.type === 'lines') return value.join(', ');
  return value;
};

function ReviewValue({ field, form }) {
  const value = form[field.key];
  if (field.type === 'chips' && value.length) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((word) => (
          <span key={word} className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-slate-700">{word}</span>
        ))}
      </span>
    );
  }
  if (field.type === 'lines' && value.length) {
    return <span className="block space-y-0.5">{value.map((line) => <span key={line} className="block break-all">{line}</span>)}</span>;
  }
  const text = summaryText(field, form);
  return text ? <span className="break-words">{text}</span> : <span className="italic text-slate-400">Skipped</span>;
}

function Review({ form, onEdit }) {
  return (
    <div className="space-y-3">
      {SEO_STEPS.map((step, index) => {
        const { Icon } = STEP_META[step.id];
        return (
          <section key={step.id} aria-labelledby={`seo-review-${step.id}`} className={`rounded-xl border border-slate-200 animate-stagger-${index + 1} motion-reduce:animate-none`}>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
              <h4 id={`seo-review-${step.id}`} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className={`${ICON_TILE} h-6 w-6 rounded-md`}><Icon size={13} aria-hidden="true" /></span>
                {step.title}
              </h4>
              <button type="button" onClick={() => onEdit(index)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100">
                <Pencil size={11} aria-hidden="true" />Edit<span className="sr-only"> {step.title}</span>
              </button>
            </div>
            <dl className="divide-y divide-slate-100 px-3.5">
              {step.id === 'site' && form.scan && (
                <div className="grid gap-x-4 gap-y-0.5 py-2 text-xs leading-snug sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <dt className="text-slate-500">Read from your site</dt>
                  <dd className="break-words text-slate-800">{form.scan.title || form.scan.description || form.scan.headings[0]}</dd>
                </div>
              )}
              {step.fields.map((field) => (
                <div key={field.key} className="grid gap-x-4 gap-y-0.5 py-2 text-xs leading-snug sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <dt className="text-slate-500">{field.label}</dt>
                  <dd className="text-slate-800"><ReviewValue field={field} form={form} /></dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

export default function SeoQuestionsModal({ project, onClose }) {
  const { profile, images, hasCode, busy, sessionId, onSave, onApply } = project;
  const saved = profile?.form && isSeoComplete(profile.form) ? profile.form : null;
  const [draft, setDraft] = useState(() => saved || emptySeoForm());
  const [step, setStep] = useState(saved ? REVIEW : 0);
  // The furthest page reached, for the step bar. Saved answers open them all.
  const [reached, setReached] = useState(saved ? REVIEW : 0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // Addresses the person said no to scanning, for this visit only.
  const [declined, setDeclined] = useState(() => new Set());
  const stepRef = useRef(null);

  // Each page starts with its first question focused (a few steps of tabbing
  // otherwise), including the first one, since the dialog opened for them.
  useEffect(() => {
    stepRef.current?.querySelector('input:not(:disabled), textarea, select, button[role="radio"][tabindex="0"]')?.focus();
  }, [step]);

  const current = step < REVIEW ? SEO_STEPS[step] : null;
  const missing = current ? current.fields.some((field) => field.required && !String(draft[field.key]).trim()) : false;
  const change = (key, value) => {
    setDraft((form) => ({ ...form, [key]: value }));
  };
  const go = (next) => {
    const target = Math.max(0, Math.min(REVIEW, next));
    setStep(target);
    setReached((furthest) => Math.max(furthest, target));
  };
  const next = () => { if (!missing) go(step + 1); };

  const normalized = normalizeSeoForm(draft);
  const dirty = !saved || hashSeoForm(normalized) !== hashSeoForm(saved);
  const pending = seoPending({ enabled: true, profile, sessionId });
  // Unsaved typing would be lost by closing, so that asks first. A blank form
  // has nothing to lose.
  const unsaved = hashSeoForm(normalized) !== hashSeoForm(saved || normalizeSeoForm(emptySeoForm()));
  const close = () => (unsaved ? setConfirmClose(true) : onClose());

  // Escape closes only this dialog, not the Settings modal underneath.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (unsaved) setConfirmClose(true);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [unsaved, onClose]);

  // The two ways out of the last page: both keep the answers; Send now also
  // asks the AI to apply them (a normal request in the usual chat).
  const later = () => {
    if (dirty) onSave(normalized);
    onClose();
  };
  const sendNow = () => {
    if (dirty) onSave(normalized);
    onApply();
    onClose();
  };
  const reset = () => {
    onSave(emptySeoForm());
    setDraft(emptySeoForm());
    setStep(0);
    setReached(0);
    setConfirmReset(false);
  };

  const { Icon: StepIcon } = metaFor(step);
  return (
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh]"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'seo-questions-title', 'aria-describedby': 'seo-questions-subtitle' }}
    >
      <div className="shrink-0 border-b border-slate-100 px-6 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`${ICON_TILE} h-9 w-9`}><Search size={18} aria-hidden="true" /></span>
            <div>
              <h2 id="seo-questions-title" className="text-base font-semibold text-slate-900 2xl:text-lg">SEO questions</h2>
              <p id="seo-questions-subtitle" className="text-xs text-slate-500">Help search engines understand this project.</p>
            </div>
          </div>
          <ModalCloseButton onClick={close} />
        </div>
        <Stepper step={step} reached={reached} blocked={missing} onGo={go} />
        <p className="sr-only" aria-live="polite">
          {current ? `Step ${step + 1} of ${REVIEW}: ${current.title}` : 'Last look'}
        </p>
      </div>

      <div className="custom-scrollbar overflow-y-auto px-6 py-5">
        <div key={step} ref={stepRef} className="animate-fade-in motion-reduce:animate-none">
          <div className="mb-5 flex items-start gap-3">
            <span className={`${ICON_TILE} h-10 w-10`}><StepIcon size={20} aria-hidden="true" /></span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {current ? `Step ${step + 1} of ${REVIEW}` : 'Last look'}
              </p>
              <h3 className="text-lg font-bold leading-tight text-slate-900">{current ? current.title : 'Does this look right?'}</h3>
              <p className="mt-1 text-sm leading-snug text-slate-600">
                {current ? current.hint : 'Check your answers, then decide when the AI should use them. You can change them any time.'}
              </p>
            </div>
          </div>
          {current ? (
            <div className="space-y-5">
              {current.fields.map((field, index) => (
                <Field
                  key={field.key}
                  field={field}
                  form={draft}
                  onChange={change}
                  images={images}
                  onEnter={next}
                  className={`animate-stagger-${index + 1} motion-reduce:animate-none`}
                />
              ))}
              {current.id === 'site' && (
                <SiteScan
                  origin={seoOrigin(draft.siteUrl)}
                  scan={normalized.scan}
                  declined={declined.has(seoOrigin(draft.siteUrl))}
                  onScan={(scan) => change('scan', scan)}
                  onDecline={(value) => setDeclined((set) => {
                    const next = new Set(set);
                    if (value) next.add(seoOrigin(draft.siteUrl)); else next.delete(seoOrigin(draft.siteUrl));
                    return next;
                  })}
                />
              )}
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/5 p-3.5 animate-fade-in motion-reduce:animate-none">
                <Send size={17} className="mt-px shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                <div className="min-w-0 text-sm leading-snug">
                  <p className="font-semibold text-slate-900">Next: let the AI add SEO to your project</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {!hasCode
                      ? 'Your answers are kept with this project, and the AI will use them when it builds it.'
                      : pending || dirty
                        ? 'Send your answers to the AI now and it will apply them to your pages in the chat. Or choose Maybe later: they stay saved, and you can ask for it from Settings → Tools → SEO any time.'
                        : 'The AI already has these answers.'}
                  </p>
                </div>
              </div>
              <Review form={normalized} onEdit={go} />
              <div className="mt-4">
                {confirmReset ? (
                  <p className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                    Clear all your answers?
                    <button type="button" onClick={reset} className="font-semibold text-slate-700 hover:underline">Yes, clear them</button>
                    <button type="button" onClick={() => setConfirmReset(false)} className={LINK_BUTTON}>Cancel</button>
                  </p>
                ) : (
                  <button type="button" onClick={() => setConfirmReset(true)} className="text-xs text-slate-500 hover:text-slate-800 hover:underline">Start over</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-6 py-3.5">
        {confirmClose ? (
          <div role="alertdialog" aria-label="Close without saving?" className="flex flex-wrap items-center justify-between gap-3 animate-fade-in motion-reduce:animate-none">
            <p className="flex items-center gap-2 text-sm text-slate-700">
              <CircleAlert size={16} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Close without saving your answers?
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setConfirmClose(false)} autoFocus className={GHOST_BUTTON}>Keep going</button>
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100">Close</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            {step > 0
              ? <button type="button" onClick={() => go(step - 1)} className={`-ml-3 ${GHOST_BUTTON}`}><ArrowLeft size={15} aria-hidden="true" />Back</button>
              : <span />}
            <div className="flex items-center gap-2">
              {current && !current.fields.some((field) => field.required) && (
                <button type="button" onClick={() => go(step + 1)} className={GHOST_BUTTON}>Skip</button>
              )}
              {current ? (
                <button type="button" onClick={next} disabled={missing} className={PRIMARY_BUTTON}>
                  {step === REVIEW - 1 ? 'Review' : 'Next'}<ArrowRight size={15} aria-hidden="true" />
                </button>
              ) : dirty || (pending && hasCode) ? (
                <>
                  <button type="button" onClick={later} className={SECONDARY_BUTTON}>{hasCode ? 'Maybe later' : 'Save'}</button>
                  {hasCode && (
                    <button type="button" onClick={sendNow} disabled={busy} title={busy ? 'Wait for the current build to finish' : undefined} className={PRIMARY_BUTTON}>
                      <Send size={15} aria-hidden="true" />Send now
                    </button>
                  )}
                </>
              ) : (
                <button type="button" onClick={onClose} className={PRIMARY_BUTTON}>Done</button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
