import { useEffect, useMemo, useState } from 'react';
import { Check, CircleCheck, Copy, ExternalLink, Search } from 'lucide-react';
import { SettingRow, Switch, FIELD_CLASS } from './SettingControls';
import { useExternalConfirm } from '../hooks/useExternalConfirm';
import { CONNECTOR_DEFINITIONS } from '../lib/connectors';
import { REACT_BITS_CATALOG } from '../lib/reactBitsCatalog';
import { REACT_BITS_CATEGORIES, reactBitsPageUrl } from '../lib/reactBits';

// Settings → Connectors → React Bits: the switch, then every free component in
// the catalog (lib/reactBitsCatalog.js) as a card. A card opens the
// component's page on reactbits.dev, where it can be seen moving; nothing is
// shown or run from React Bits inside AppBlips. "Copy name" copies the words a
// request needs ("React Bits Flying Button") so lib/reactBits.js matches it.
const CATEGORY_LABELS = Object.fromEntries(REACT_BITS_CATEGORIES.map(({ id, label }) => [id, label]));

function CopyNameButton({ title }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!state) return undefined;
    const timer = setTimeout(() => setState(null), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`React Bits ${title}`);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === 'copied' ? 'Copied' : `Copy name: React Bits ${title}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
        state === 'copied' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'text-indigo-600 hover:bg-indigo-500/10'
      }`}
    >
      {state === 'copied' ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : 'Copy name'}
    </button>
  );
}

export default function ReactBitsConnector({ state, onChange }) {
  const { page } = CONNECTOR_DEFINITIONS.reactbits;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const { ask, dialog } = useExternalConfirm();

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return REACT_BITS_CATALOG.filter((component) => (category === 'all' || component.category === category)
      && words.every((word) => `${component.title} ${component.description}`.toLowerCase().includes(word)));
  }, [query, category]);

  const open = (component) => ask({
    url: reactBitsPageUrl(component),
    site: 'React Bits',
    why: `To see ${component.title} moving and try its settings on the React Bits website. To add it, ask for “React Bits ${component.title}” in the builder chat.`,
  });

  const chip = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setCategory(id)}
      aria-pressed={category === id}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
        category === id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <SettingRow id="set-reactbits" title="Enable React Bits" description={page.enableDescription}>
        <Switch checked={state.enabled} onChange={(enabled) => onChange({ enabled })} labelledBy="set-reactbits" />
      </SettingRow>
      {state.enabled && (
        <p role="status" className="inline-flex items-start gap-1.5 pt-3 text-xs text-emerald-600">
          <CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />{page.connected}
        </p>
      )}
      <div className="py-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Free components</h4>
          <p className="mt-0.5 text-xs leading-snug text-slate-600">
            Click a component to see it on the React Bits website. To add one, say “React Bits” and its name in the builder chat,
            for example “Add the React Bits Flying Button to the hero section”. Only the free components are available.
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search components, e.g. text, button, background"
            aria-label="Search React Bits components"
            className={`${FIELD_CLASS} pl-8`}
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          {chip('all', 'All')}
          {REACT_BITS_CATEGORIES.map(({ id, label }) => chip(id, label))}
        </div>
        <p className="text-xs text-slate-500" aria-live="polite">
          {shown.length === 1 ? '1 component' : `${shown.length} components`}
        </p>
        {shown.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shown.map((component) => (
              <li key={component.id} className="flex flex-col rounded-xl border border-slate-200 bg-surface dark:border-white/10 dark:bg-[#1f1f1f]">
                <button
                  type="button"
                  onClick={() => open(component)}
                  className="group flex flex-1 flex-col items-start gap-1 rounded-t-xl p-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{component.title}</span>
                    <ExternalLink size={12} className="shrink-0 text-slate-400 group-hover:text-indigo-600" aria-hidden="true" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">{CATEGORY_LABELS[component.category]}</span>
                  <span className="text-xs leading-snug text-slate-600">{component.description}</span>
                </button>
                <div className="flex justify-end border-t border-slate-200 px-2 py-1.5 dark:border-white/10">
                  <CopyNameButton title={component.title} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">No components match. Try another word, or pick All.</p>
        )}
      </div>
      {dialog}
    </>
  );
}
