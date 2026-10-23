import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Check, CircleCheck, CircleAlert, Copy, CreditCard, ExternalLink, Info, MessagesSquare, Plus,
} from 'lucide-react';
import { SettingRow, Switch, FIELD_CLASS } from './SettingControls';
import ConnectorInfoModal from './ConnectorInfoModal';
import ConnectorRequestModal from './ConnectorRequestModal';
import PublishDialog from './PublishDialog';
import {
  CONNECTOR_DEFINITIONS, CONNECTOR_IDS, connectorStatus, loadConnectors, saveConnectors,
} from '../lib/connectors';
import { surgeStatus } from '../lib/surge';

// Settings → Connectors: a grid of services the AI can wire into new projects.
// A card opens that service's page (switch, key, help). Changes save as you
// type; llm.js reads the saved state when it builds, so there is no Save step.
// To add a service: add its definition in lib/connectors.js (with the `page`
// wording, the `prompts` users copy into the builder chat and the `about`
// text the "How it works" dialog shows), its
// instructions in prompts.js (CONNECTOR_DIRECTIVES), and its icon below.
// Service logos are used as masks so they take the text colour like the
// lucide icons beside them, and stay visible in both themes.
const logoIcon = (src) => function LogoIcon({ size }) {
  const mask = `url(${src}) center / contain no-repeat`;
  return <span aria-hidden="true" className="inline-block bg-current" style={{ width: size, height: size, mask, WebkitMask: mask }} />;
};

// Web3Forms' cube relies on its shaded faces, which a mask would flatten, so it
// keeps its own colours (a blue close to the indigo of the others). Surge's
// multi-coloured mascot is the same.
const colourIcon = (src) => function ColourIcon({ size }) {
  return <img src={src} alt="" aria-hidden="true" width={size} height={size} />;
};
const Web3FormsIcon = colourIcon('/web3forms-logo.png');
const SurgeIcon = colourIcon('/surge-logo.svg');

const ICONS = {
  web3forms: Web3FormsIcon, umami: logoIcon('/umami-logo.png'), plausible: logoIcon('/plausible-logo.svg'), tawkto: MessagesSquare,
  square: CreditCard,
};

const STATUS_BADGE = {
  connected: { label: 'Connected', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  'needs-key': { label: 'Needs key', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  off: { label: 'Not connected', className: 'bg-slate-500/10 text-slate-600' },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const { label, className } = STATUS_BADGE[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
}

function ConnectorCard({ name, tagline, Icon, status, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-xl border border-slate-200 bg-surface p-4 text-left shadow-[0_1px_2px_rgb(15_23_42/0.06),0_4px_12px_-2px_rgb(15_23_42/0.10)] transition-[transform,box-shadow] duration-100 active:translate-y-px active:scale-[0.98] active:shadow-[0_1px_2px_rgb(15_23_42/0.08)] dark:border-white/10 dark:bg-[#1f1f1f] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_8px_20px_-6px_rgb(0_0_0/0.8)] dark:active:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_2px_6px_-2px_rgb(0_0_0/0.8)] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
          <Icon size={20} aria-hidden="true" />
        </span>
        <StatusBadge status={status} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{name}</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-600">{tagline}</span>
      </span>
    </button>
  );
}

// One page for every connector: an on/off switch and the key (or, for
// analytics, the tracking code), with its wording from the definition's `page`.
function ConnectorPage({ id, state, onChange }) {
  const def = CONNECTOR_DEFINITIONS[id];
  const { page } = def;
  const key = state.key.trim();
  const keyBad = state.enabled && key !== '' && !def.isValidKey(key);
  const status = connectorStatus(id, { [id]: state });
  const Field = def.multiline ? 'textarea' : 'input';
  return (
    <>
      <SettingRow
        id={`set-${id}`}
        title={`Enable ${def.name}`}
        description={page.enableDescription}
      >
        <Switch checked={state.enabled} onChange={(enabled) => onChange({ enabled })} labelledBy={`set-${id}`} />
      </SettingRow>
      {state.enabled && (
        <div className="py-4 space-y-2">
          <label htmlFor={`set-${id}-key`} className="block text-sm font-semibold text-slate-900">{def.keyLabel}</label>
          <Field
            id={`set-${id}-key`}
            {...(def.multiline ? { rows: 4 } : { type: 'text' })}
            value={state.key}
            onChange={(event) => onChange({ key: event.target.value })}
            placeholder={def.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={keyBad}
            aria-describedby={`set-${id}-help`}
            className={`${FIELD_CLASS} font-mono${def.multiline ? ' resize-y text-xs' : ''}`}
          />
          <p id={`set-${id}-help`} className="text-xs leading-snug text-slate-600">
            {page.keyHelp}{' '}
            <a href={def.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
              {page.keyLinkLabel}<ExternalLink size={11} aria-hidden="true" />
            </a>
          </p>
          <p
            role={keyBad ? 'alert' : 'status'}
            className={`inline-flex items-start gap-1.5 text-xs ${keyBad ? 'text-red-600' : status === 'connected' ? 'text-emerald-600' : 'text-slate-600'}`}
          >
            {keyBad && <><CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{def.looksSecret?.(key) ? page.secret : page.invalid}</>}
            {!keyBad && status === 'connected' && <><CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />{page.connected}</>}
            {!keyBad && status === 'needs-key' && page.needsKey}
          </p>
        </div>
      )}
    </>
  );
}

// Ready-made requests (the definition's `prompts`) to paste into the builder
// chat. The text is selectable too, for when the clipboard is blocked.
function ConnectorPrompts({ id, connected }) {
  const { name, prompts } = CONNECTOR_DEFINITIONS[id];
  const [copied, setCopied] = useState(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (copied === null) return undefined;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (index) => {
    try {
      await navigator.clipboard.writeText(prompts[index]);
      setCopyFailed(false);
      setCopied(index);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="py-4 space-y-2">
      <h4 className="text-sm font-semibold text-slate-900">Prompts to try</h4>
      <p className="text-xs leading-snug text-slate-600">
        Copy a prompt and paste it into the builder chat to add {name} to the project you have open.
        {!connected && ` They work once ${name} is connected.`}
      </p>
      <ul className="space-y-2">
        {prompts.map((prompt, index) => (
          <li key={prompt} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="min-w-0 flex-1 select-all text-xs leading-snug text-slate-800">{prompt}</p>
            <button
              type="button"
              onClick={() => copy(index)}
              aria-label={copied === index ? 'Copied' : `Copy prompt: ${prompt}`}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                copied === index ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'text-indigo-600 hover:bg-indigo-500/10'
              }`}
            >
              {copied === index ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied === index ? 'Copied' : 'Copy'}
            </button>
          </li>
        ))}
      </ul>
      {copyFailed && (
        <p role="alert" className="text-xs text-red-600">Couldn’t copy. Click the prompt to select it, then copy it yourself.</p>
      )}
    </div>
  );
}

export default function ConnectorsSettings() {
  const [connectors, setConnectors] = useState(loadConnectors);
  const [openId, setOpenId] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  // Surge isn't an AI connector: it's the account Publish uses, so its card
  // opens the Publish window's sign-in instead of a connector page. null
  // until the server answers (no badge rather than a wrong one).
  const [surgeOpen, setSurgeOpen] = useState(false);
  const [surgeConnected, setSurgeConnected] = useState(null);

  // Re-checked whenever the Surge window closes, since it can sign in or out.
  useEffect(() => {
    if (surgeOpen) return undefined;
    let live = true;
    surgeStatus().then((status) => live && setSurgeConnected(Boolean(status.signedIn)));
    return () => { live = false; };
  }, [surgeOpen]);

  const update = (id, fields) => {
    setConnectors((current) => {
      const next = { ...current, [id]: { ...current[id], ...fields } };
      saveConnectors(next);
      return next;
    });
  };

  if (openId) {
    const { name, description, homeUrl, homeLinkLabel } = CONNECTOR_DEFINITIONS[openId];
    const Icon = ICONS[openId];
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="-ml-2 mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Connectors
        </button>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">{name}</h3>
            <p className="mt-0.5 text-xs leading-snug text-slate-600">{description}</p>
            {homeUrl && (
              <a href={homeUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">
                {homeLinkLabel}<ExternalLink size={11} aria-hidden="true" />
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Info size={14} aria-hidden="true" />
            How it works
          </button>
        </div>
        <div className="mt-4 divide-y divide-slate-200 border-t border-slate-200 pt-4">
          <ConnectorPage key={openId} id={openId} state={connectors[openId]} onChange={(fields) => update(openId, fields)} />
          <ConnectorPrompts key={`${openId}-prompts`} id={openId} connected={connectorStatus(openId, connectors) === 'connected'} />
        </div>
        {/* Portaled out of the settings card: a fixed overlay inside it would be
            clipped by the card's overflow. */}
        {infoOpen && createPortal(
          <ConnectorInfoModal id={openId} onClose={() => setInfoOpen(false)} />,
          document.body,
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-xs leading-snug text-slate-600">
        Connect services and the AI will wire them into your projects. Pick one to set it up.
      </p>
      {/* The cards and the modal are both bg-surface, so they sit on a recessed
          tray to read as separate, raised tiles. On dark, shadows barely show
          and surface equals the modal, so the cards also get a lighter fill. */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70 sm:grid-cols-2 sm:p-4">
        {CONNECTOR_IDS.map((id) => (
          <ConnectorCard
            key={id}
            name={CONNECTOR_DEFINITIONS[id].name}
            tagline={CONNECTOR_DEFINITIONS[id].tagline}
            Icon={ICONS[id]}
            status={connectorStatus(id, connectors)}
            onClick={() => setOpenId(id)}
          />
        ))}
        <ConnectorCard
          name="Surge"
          tagline="Free hosting that Publish uses to put your sites online."
          Icon={SurgeIcon}
          status={surgeConnected === null ? null : surgeConnected ? 'connected' : 'off'}
          onClick={() => setSurgeOpen(true)}
        />
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-slate-300 p-4 text-left transition-transform duration-100 active:translate-y-px active:scale-[0.98] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/10 text-slate-600">
            <Plus size={20} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">Request a connector</span>
            <span className="mt-0.5 block text-xs leading-snug text-slate-600">Missing a service? Tell us which one.</span>
          </span>
        </button>
      </div>
      {surgeOpen && createPortal(
        <PublishDialog connectOnly onClose={() => setSurgeOpen(false)} />,
        document.body,
      )}
      {requestOpen && createPortal(
        <ConnectorRequestModal onClose={() => setRequestOpen(false)} />,
        document.body,
      )}
    </div>
  );
}
