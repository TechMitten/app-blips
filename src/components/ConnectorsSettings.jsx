import { useState } from 'react';
import { ArrowLeft, CircleCheck, CircleAlert, ExternalLink, Info, Mail } from 'lucide-react';
import { SettingRow, Switch, FIELD_CLASS } from './SettingControls';
import ConnectorInfoModal from './ConnectorInfoModal';
import {
  CONNECTOR_DEFINITIONS, CONNECTOR_IDS, connectorStatus, loadConnectors, saveConnectors,
} from '../lib/connectors';

// Settings → Connectors: a grid of services the AI can wire into new projects.
// A card opens that service's page (switch, key, help). Changes save as you
// type; llm.js reads the saved state when it builds, so there is no Save step.
// To add a service: add its definition in lib/connectors.js (with the `about`
// text the "How it works" dialog shows), its instructions in prompts.js
// (CONNECTOR_DIRECTIVES), and its icon and page below.
const ICONS = { web3forms: Mail };

const STATUS_BADGE = {
  connected: { label: 'Connected', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  'needs-key': { label: 'Needs key', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  off: { label: 'Not connected', className: 'bg-slate-500/10 text-slate-600' },
};

function StatusBadge({ status }) {
  const { label, className } = STATUS_BADGE[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
}

function ConnectorCard({ id, status, onOpen }) {
  const { name, tagline } = CONNECTOR_DEFINITIONS[id];
  const Icon = ICONS[id];
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="group flex flex-col items-start gap-3 rounded-xl border border-slate-200 bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
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

function Web3FormsPage({ state, onChange }) {
  const def = CONNECTOR_DEFINITIONS.web3forms;
  const key = state.key.trim();
  const keyBad = state.enabled && key !== '' && !def.isValidKey(key);
  const status = connectorStatus('web3forms', { web3forms: state });
  return (
    <>
      <SettingRow
        id="set-web3forms"
        title="Enable Web3Forms"
        description="Forms the AI builds will send their entries to your email through Web3Forms."
      >
        <Switch checked={state.enabled} onChange={(enabled) => onChange({ enabled })} labelledBy="set-web3forms" />
      </SettingRow>
      {state.enabled && (
        <div className="py-4 space-y-2">
          <label htmlFor="set-web3forms-key" className="block text-sm font-semibold text-slate-900">{def.keyLabel}</label>
          <input
            id="set-web3forms-key"
            type="text"
            value={state.key}
            onChange={(event) => onChange({ key: event.target.value })}
            placeholder={def.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={keyBad}
            aria-describedby="set-web3forms-help"
            className={`${FIELD_CLASS} font-mono`}
          />
          <p id="set-web3forms-help" className="text-xs leading-snug text-slate-600">
            Enter your public access key. It is meant to sit in a website&rsquo;s code and only sends mail to your inbox, so it is safe to share.{' '}
            <a href={def.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
              Get a free key<ExternalLink size={11} aria-hidden="true" />
            </a>
          </p>
          <p
            role={keyBad ? 'alert' : 'status'}
            className={`inline-flex items-start gap-1.5 text-xs ${keyBad ? 'text-red-600' : status === 'connected' ? 'text-emerald-600' : 'text-slate-600'}`}
          >
            {keyBad && <><CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />That doesn&rsquo;t look like an access key. It has 36 characters, in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.</>}
            {!keyBad && status === 'connected' && <><CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />Connected. Websites and apps you build or edit from now on will use it for their forms.</>}
            {!keyBad && status === 'needs-key' && 'Add your key to finish setting up.'}
          </p>
        </div>
      )}
    </>
  );
}

const PAGES = { web3forms: Web3FormsPage };

export default function ConnectorsSettings() {
  const [connectors, setConnectors] = useState(loadConnectors);
  const [openId, setOpenId] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const update = (id, fields) => {
    setConnectors((current) => {
      const next = { ...current, [id]: { ...current[id], ...fields } };
      saveConnectors(next);
      return next;
    });
  };

  if (openId) {
    const { name, description } = CONNECTOR_DEFINITIONS[openId];
    const Icon = ICONS[openId];
    const Page = PAGES[openId];
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
          <Page state={connectors[openId]} onChange={(fields) => update(openId, fields)} />
        </div>
        {infoOpen && <ConnectorInfoModal id={openId} onClose={() => setInfoOpen(false)} />}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-xs leading-snug text-slate-600">
        Connect services and the AI will wire them into your projects. Pick one to set it up.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CONNECTOR_IDS.map((id) => (
          <ConnectorCard key={id} id={id} status={connectorStatus(id, connectors)} onOpen={setOpenId} />
        ))}
      </div>
    </div>
  );
}
