import { ConfirmedLink } from './ExternalLinkConfirm';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Camera, Check, CircleCheck, CircleAlert, Copy, CreditCard, ExternalLink, Globe, Images, Info, MessagesSquare, Plus, Search, Sparkles,
} from 'lucide-react';
import { SettingRow, Switch, FIELD_CLASS } from './SettingControls';
import ConnectorInfoModal from './ConnectorInfoModal';
import ConnectorRequestModal from './ConnectorRequestModal';
import PollinationsConnector from './PollinationsConnector';
import PixabayConnector from './PixabayConnector';
import ServerKeyConnector from './ServerKeyConnector';
import SeoConnector from './SeoConnector';
import ImagesConnector from './ImagesConnector';
import ReactBitsConnector from './ReactBitsConnector';
import PublishDialog from './PublishDialog';
import {
  CONNECTOR_DEFINITIONS, CONNECTOR_IDS, connectorStatus, loadConnectors, saveConnectors,
} from '../lib/connectors';
import { surgeStatus } from '../lib/surge';
import { galleryNameForms } from '../lib/galleryImages';
import { forgetTavilyKey, saveTavilyKey, tavilyStatus } from '../lib/tavily';

// Settings → Connectors: a grid of services the AI can wire into new projects.
// Settings → Tools is the same component with `kind="tools"`: the native
// connectors (`native: true`, no service or key: SEO and My images), which
// share the connector state and pages but have no connection to show, so their
// cards say On/Off. A card opens that service's page (switch, key, help). Changes save as you
// type; llm.js reads the saved state when it builds, so there is no Save step.
// To add a service: add its definition in lib/connectors.js (with the `page`
// wording, the `prompts` users copy into the builder chat, if any, and the `about`
// text the "How it works" dialog shows), its
// instructions in prompts.js (CONNECTOR_DIRECTIVES), and its icon below.
// Pollinations signs in instead of taking a key, so it has its own page
// (PollinationsConnector.jsx). My images and SEO are native (no service): SEO's page is a
// questionnaire about the open project (SeoConnector.jsx), saved on the project
// by App.jsx rather than here, and `seoProject` is what it needs from App.
// My images has a switch like SEO; `galleryProject` (useImageGallery's
// actions and the images) lets its page show the project's gallery; App.jsx
// owns the images. Pixabay keeps its key server-side (`serverKey`), so it has
// its own page too (PixabayConnector.jsx); its photo search adds to the same
// gallery, and is also offered on the My images page. Tavily keeps its key the
// same way and uses the plain server-key page (ServerKeyConnector.jsx); the AI
// searches with it (lib/webSearch.js). React Bits has no key (`keyless`): its
// page is the switch and the component catalog (ReactBitsConnector.jsx).
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

const TAVILY_API = { status: tavilyStatus, save: saveTavilyKey, forget: forgetTavilyKey };

const ICONS = {
  web3forms: Web3FormsIcon, umami: logoIcon('/umami-logo.png'), plausible: logoIcon('/plausible-logo.svg'), tawkto: MessagesSquare,
  square: CreditCard, pollinations: logoIcon('/pollinations-logo.svg'), pixabay: Camera, tavily: Globe, reactbits: Sparkles, seo: Search, images: Images,
};

const STATUS_BADGE = {
  connected: { label: 'Connected', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  'needs-key': { label: 'Needs key', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  'needs-sign-in': { label: 'Needs sign-in', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  off: { label: 'Not connected', className: 'bg-slate-500/10 text-slate-600' },
};

// Tools have nothing to connect, so their cards only say whether they're on.
const TOOL_BADGE = {
  connected: { label: 'On', className: STATUS_BADGE.connected.className },
  off: { label: 'Off', className: STATUS_BADGE.off.className },
};

function StatusBadge({ status, tool = false }) {
  if (!status) return null;
  if (tool) {
    const { label, className } = TOOL_BADGE[status];
    return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
  }
  const { label, className } = STATUS_BADGE[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
}

// Same pill as Code Review's in Settings → AI; `beta` is set in the definition.
function BetaBadge() {
  return <span className="ml-1.5 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 bg-indigo-500/15 dark:text-indigo-300">Beta</span>;
}

// A locked connector (`comingSoon` in its definition) shows its card dimmed,
// with a Coming soon badge, and doesn't open.
function ComingSoonBadge() {
  return <span className="shrink-0 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Coming soon</span>;
}

function ConnectorCard({ name, tagline, Icon, status, beta = false, tool = false, comingSoon = false, onClick }) {
  return (
    <button
      type="button"
      onClick={comingSoon ? undefined : onClick}
      disabled={comingSoon}
      aria-label={comingSoon ? `${name}: coming soon` : undefined}
      className="group flex flex-col items-start gap-3 rounded-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0 disabled:active:scale-100 border border-slate-200 bg-surface p-4 text-left shadow-[0_1px_2px_rgb(15_23_42/0.06),0_4px_12px_-2px_rgb(15_23_42/0.10)] transition-[transform,box-shadow] duration-100 active:translate-y-px active:scale-[0.98] active:shadow-[0_1px_2px_rgb(15_23_42/0.08)] dark:border-white/10 dark:bg-[#1f1f1f] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_8px_20px_-6px_rgb(0_0_0/0.8)] dark:active:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_2px_6px_-2px_rgb(0_0_0/0.8)] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg text-indigo-600">
          <Icon size={20} aria-hidden="true" />
        </span>
        {comingSoon ? <ComingSoonBadge /> : <StatusBadge status={status} tool={tool} />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{name}{beta && <BetaBadge />}</span>
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
            <ConfirmedLink href={def.keyUrl} why={`To create or copy the key that lets AppBlips connect to ${def.name}. Keys are made on the service's own website.`} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
              {page.keyLinkLabel}<ExternalLink size={11} aria-hidden="true" />
            </ConfirmedLink>
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

// The image named in My images' prompts when the project has no image the AI
// can use yet.
const SAMPLE_IMAGE_NAME = 'team-photo.jpg';

// Ready-made requests (the definition's `prompts`) to paste into the builder
// chat. The text is selectable too, for when the clipboard is blocked.
// For My images, `{image}`, `{stem}` and `{partial}` become the full name,
// the name without extension and a few words of one of `images` (the
// visible ones), or of a sample name when there are none.
function ConnectorPrompts({ id, connected, images = [] }) {
  const { name, native, prompts: rawPrompts } = CONNECTOR_DEFINITIONS[id];
  const usesImage = rawPrompts.some((prompt) => /\{(?:image|stem|partial)\}/.test(prompt));
  const imageName = images[0]?.name || '';
  const forms = galleryNameForms(imageName || SAMPLE_IMAGE_NAME, images);
  const prompts = rawPrompts.map((prompt) => prompt
    .replaceAll('{image}', forms.name)
    .replaceAll('{stem}', forms.stem)
    .replaceAll('{partial}', forms.partial));
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
        {!connected && ` They work once ${name} is ${native ? 'turned on' : 'connected'}.`}
      </p>
      {usesImage && (
        <p className="text-xs leading-snug text-slate-600">
          To pick an image, name it in your request. The exact name is safest, but it can be shorter: without
          {' '}“.{forms.name.split('.').pop()}”, or just a few of its words, like “{forms.partial}”.{' '}
          {imageName
            ? <>These use <strong>{imageName}</strong>, one of yours: swap in another image’s name (click <strong>Copy name</strong> on it) to use that one instead.</>
            : <>Swap <strong>{SAMPLE_IMAGE_NAME}</strong> for the name of one of your images (click <strong>Copy name</strong> on it).</>}
        </p>
      )}
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

const TAB_NAMES = { services: 'Connectors', tools: 'Tools' };

export default function ConnectorsSettings({ kind = 'services', seoProject = null, galleryProject = null }) {
  const [connectors, setConnectors] = useState(loadConnectors);
  // The open pages, newest last. My images links to Pixabay (a service, from
  // the Tools tab), so Back returns to the page it came from, not the grid.
  const [pageStack, setPageStack] = useState([]);
  const openId = pageStack.at(-1) ?? null;
  const setOpenId = (id) => setPageStack((stack) => (id ? [...stack, id] : []));
  const goBack = () => setPageStack((stack) => stack.slice(0, -1));
  const backLabel = pageStack.length > 1 ? CONNECTOR_DEFINITIONS[pageStack.at(-2)].name : TAB_NAMES[kind];
  // SEO is switched on per project, so its state is the open project's, not
  // the shared connector settings (always Off with no project open).
  const statusOf = (id) => (id === 'seo' ? (seoProject?.enabled ? 'connected' : 'off') : connectorStatus(id, connectors));
  const ids = CONNECTOR_IDS.filter((id) => Boolean(CONNECTOR_DEFINITIONS[id].native) === (kind === 'tools'));
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
    const { name, description, homeUrl, homeLinkLabel, beta } = CONNECTOR_DEFINITIONS[openId];
    const Icon = ICONS[openId];
    return (
      <div>
        <button
          type="button"
          onClick={goBack}
          className="-ml-2 mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {backLabel}
        </button>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-indigo-600">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">{name}{beta && <BetaBadge />}</h3>
            <p className="mt-0.5 text-xs leading-snug text-slate-600">{description}</p>
            {homeUrl && (
              <ConfirmedLink href={homeUrl} why={`To read about ${name} on its own website.`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">
                {homeLinkLabel}<ExternalLink size={11} aria-hidden="true" />
              </ConfirmedLink>
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
          {CONNECTOR_DEFINITIONS[openId].gallery
            ? (
              <ImagesConnector
                key={openId}
                state={connectors[openId]}
                onChange={(fields) => update(openId, fields)}
                galleryProject={galleryProject}
                pixabayConnected={connectorStatus('pixabay', connectors) === 'connected'}
                onOpenPixabay={() => setOpenId('pixabay')}
              />
            )
            : CONNECTOR_DEFINITIONS[openId].native
            ? <SeoConnector key={openId} seoProject={seoProject} />
            : CONNECTOR_DEFINITIONS[openId].signIn
              ? <PollinationsConnector key={openId} state={connectors[openId]} onChange={(fields) => update(openId, fields)} />
              : openId === 'reactbits'
                ? <ReactBitsConnector key={openId} state={connectors[openId]} onChange={(fields) => update(openId, fields)} />
              : openId === 'tavily'
                ? <ServerKeyConnector key={openId} id={openId} api={TAVILY_API} state={connectors[openId]} onChange={(fields) => update(openId, fields)} />
              : CONNECTOR_DEFINITIONS[openId].serverKey
                ? (
                  <PixabayConnector
                    key={openId}
                    state={connectors[openId]}
                    onChange={(fields) => update(openId, fields)}
                    galleryProject={galleryProject}
                    imagesEnabled={connectors.images.enabled}
                    onEnableImages={() => update('images', { enabled: true })}
                  />
                )
                : <ConnectorPage key={openId} id={openId} state={connectors[openId]} onChange={(fields) => update(openId, fields)} />}
          {CONNECTOR_DEFINITIONS[openId].prompts?.length > 0 && (
            <ConnectorPrompts
              key={`${openId}-prompts`}
              id={openId}
              connected={statusOf(openId) === 'connected'}
              images={galleryProject?.images.filter((image) => image.enabled !== false)}
            />
          )}
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
        {kind === 'tools'
          ? 'Built into AppBlips, with no account or key to set up. Turn one on and the AI uses it in your projects.'
          : 'Connect services and the AI will wire them into your projects. Pick one to set it up.'}
      </p>
      {/* The cards and the modal are both bg-surface, so they sit on a recessed
          tray to read as separate, raised tiles. On dark, shadows barely show
          and surface equals the modal, so the cards also get a lighter fill. */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70 sm:grid-cols-2 sm:p-4">
        {ids.map((id) => (
          <ConnectorCard
            key={id}
            name={CONNECTOR_DEFINITIONS[id].name}
            tagline={CONNECTOR_DEFINITIONS[id].tagline}
            Icon={ICONS[id]}
            beta={CONNECTOR_DEFINITIONS[id].beta}
            comingSoon={CONNECTOR_DEFINITIONS[id].comingSoon}
            status={statusOf(id)}
            tool={kind === 'tools'}
            onClick={() => setOpenId(id)}
          />
        ))}
        {kind === 'services' && <>
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
          <span className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600">
            <Plus size={20} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">Request a connector</span>
            <span className="mt-0.5 block text-xs leading-snug text-slate-600">Missing a service? Tell us which one.</span>
          </span>
        </button>
        </>}
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
