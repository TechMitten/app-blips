import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, Coins, Cpu, Eye, EyeOff,
  FolderOpen, Info, KeyRound, Laptop, Loader2, Mail, Sparkles, UserRound, X,
} from 'lucide-react';
import { desktopBridge, ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';
import { creditsConnect, creditsVerify } from '../lib/credits';
import { logError, logWarn } from '../lib/errorLog';
import { AVATAR_IDS, AVATAR_LABELS, MAX_NAME_LENGTH, cleanName, loadProfile, saveProfile } from '../lib/profile';
import { USER_PROVIDER_OPTIONS } from '../../electron/server/providers.js';
import Modal from './Modal';
import ProfileAvatar from './ProfileAvatar';
import ModelCombobox from './ModelCombobox';
import useProviderModels from '../hooks/useProviderModels';
import useAnchoredList from '../hooks/useAnchoredList';

const defaultProvider = USER_PROVIDER_OPTIONS[0];
const PRICING_URL = 'https://appblips.com/#pricing';

// One labelled field. `error` appears only after the user has tried to
// continue, so an untouched form doesn't open covered in red.
function SetupField({ title, optional, error, children }) {
  return (
    <div className={`onboarding-field ${error ? 'is-invalid' : ''}`}>
      <span className="onboarding-field-label">{title}{optional && <em>Optional</em>}</span>
      {children}
      {error && <p className="onboarding-field-error" role="alert"><CircleAlert size={15} /> {error}</p>}
    </div>
  );
}

// OpenRouter's mark (two routes merging); the other providers get a generic
// glyph rather than a copied logo.
function ProviderGlyph({ id }) {
  if (id !== 'openrouter') return <Cpu size={18} />;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12h3.5c2.5 0 3.5-5 7-5H17" /><path d="M2 12h3.5c2.5 0 3.5 5 7 5H17" />
      <path d="M15 4.5 18 7l-3 2.5" /><path d="M15 14.5 18 17l-3 2.5" />
    </svg>
  );
}

// A native <select> here let some phone browsers open their picker at the top
// of the screen, nowhere near the field (the page scrolls inside a fixed
// layer), so this is a small listbox placed the same way as the model list.
function ProviderSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [position, place] = useAnchoredList(wrapRef, listRef, open);
  const selected = USER_PROVIDER_OPTIONS.find((option) => option.id === value) || defaultProvider;

  const openList = () => {
    place();
    setActive(Math.max(0, USER_PROVIDER_OPTIONS.findIndex((option) => option.id === value)));
    setOpen(true);
  };
  const choose = (option) => {
    if (option.id !== value) onChange(option.id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (event) => {
    const last = USER_PROVIDER_OPTIONS.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openList();
      setActive((index) => (event.key === 'ArrowDown' ? Math.min(last, index + 1) : Math.max(0, index - 1)));
    } else if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : last);
    } else if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      choose(USER_PROVIDER_OPTIONS[active]);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <span ref={wrapRef} className="onboarding-select-wrap">
      <ProviderGlyph id={selected.id} />
      <button
        ref={buttonRef}
        type="button"
        className="onboarding-select"
        role="combobox"
        aria-label="AI provider"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {selected.label}
      </button>
      <ChevronDown size={18} />
      {open && position && createPortal(
        <ul ref={listRef} id={listId} role="listbox" aria-label="AI provider" className="model-combobox-list" style={{ position: 'fixed', ...position }} onMouseDown={(event) => event.preventDefault() /* keep focus on the button */}>
          {USER_PROVIDER_OPTIONS.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.id === value}
              className={`model-combobox-option onboarding-provider-option${index === active ? ' is-active' : ''}${option.id === value ? ' is-selected' : ''}`}
              onMouseMove={() => { if (index !== active) setActive(index); }}
              onClick={() => choose(option)}
            >
              <span className="model-combobox-text"><span className="model-combobox-label">{option.label}</span></span>
              {option.id === value && <Check size={14} className="model-combobox-check" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </span>
  );
}

// Shown when the model list is opened before a key is entered: the list comes
// from the provider, so it can't load without one. Portaled to <body> because
// the setup card's backdrop-filter would otherwise trap a fixed overlay inside
// it; force-dark keeps it in the page's look even when the app theme is light.
function NeedKeyModal({ providerLabel, onClose }) {
  return createPortal(
    <Modal
      zIndex={1200}
      scrimClass="force-dark fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4"
      cardClass="onboarding-info-modal animate-scale-in"
      cardProps={{
        role: 'alertdialog',
        'aria-modal': true,
        'aria-labelledby': 'onboarding-need-key-title',
        'aria-describedby': 'onboarding-need-key-text',
        onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } },
      }}
    >
      <span className="onboarding-info-icon"><Info size={22} /></span>
      <h2 id="onboarding-need-key-title">Add your API key first</h2>
      <p id="onboarding-need-key-text">
        AppBlips gets the list of models from {providerLabel}, so it needs your {providerLabel} API key before you can choose one. Paste your key in the API key box, then pick a model.
      </p>
      <button type="button" className="onboarding-next" onClick={onClose} autoFocus>Add my key</button>
    </Modal>,
    document.body,
  );
}

// Asked before "I'm new to AI Credits" leaves the app for the website, so the
// browser opening isn't a surprise. Portaled like NeedKeyModal.
function OpenWebsiteModal({ onOpen, onClose }) {
  return createPortal(
    <Modal
      zIndex={1200}
      scrimClass="force-dark fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4"
      cardClass="onboarding-info-modal animate-scale-in"
      cardProps={{
        role: 'alertdialog',
        'aria-modal': true,
        'aria-labelledby': 'onboarding-open-site-title',
        'aria-describedby': 'onboarding-open-site-text',
        onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } },
      }}
    >
      <span className="onboarding-info-icon"><ArrowUpRight size={22} /></span>
      <h2 id="onboarding-open-site-title">Open the AppBlips website?</h2>
      <p id="onboarding-open-site-text">
        To see pricing and sign up, AppBlips will open appblips.com in your web browser. When you’ve finished, come back here and choose I already have AI Credits.
      </p>
      <div className="onboarding-info-actions">
        <button type="button" className="onboarding-skip" onClick={onClose}>Not now</button>
        <button type="button" className="onboarding-next" onClick={onOpen} autoFocus>Open website <ArrowUpRight size={18} /></button>
      </div>
    </Modal>,
    document.body,
  );
}

function SetupForm({ formRef, onSubmit, provider, setProviderId, baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption, errors }) {
  const modelList = useProviderModels({ id: provider.id, apiKey, baseUrl });
  const [needKey, setNeedKey] = useState(false);

  // Local servers (LM Studio, Ollama) list models without a key.
  const canOpenModels = () => {
    if (provider.local || apiKey.trim()) return true;
    setNeedKey(true);
    return false;
  };
  const closeNeedKey = () => {
    setNeedKey(false);
    formRef.current?.querySelector('[data-field="key"]')?.focus();
  };
  const keyUrl = provider.id === 'gemini' ? 'https://aistudio.google.com/apikey' : provider.id === 'deepseek' ? 'https://platform.deepseek.com/api_keys' : provider.id === 'openai' ? 'https://platform.openai.com/api-keys' : provider.id === 'anthropic' ? 'https://platform.claude.com/settings/keys' : 'https://openrouter.ai/settings/keys';

  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <SetupField title="Provider">
        <ProviderSelect value={provider.id} onChange={setProviderId} />
        {provider.local && (
          <>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={provider.baseUrl} className="onboarding-select onboarding-url" aria-label="Local server URL" />
            <p className="onboarding-key-help">Start your local server and load a model that supports tool calling.</p>
          </>
        )}
      </SetupField>

      <SetupField title="API key" optional={provider.local} error={errors.key}>
        <span className="onboarding-key-input">
          <KeyRound size={19} />
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider.local ? 'Optional API key' : `Your ${provider.label} API key`}
            aria-label={`${provider.label} API key`}
            aria-invalid={Boolean(errors.key)}
            data-field="key"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
            {showKey ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </span>
        {!provider.local && (
          <p className="onboarding-key-help">
            {isDesktop ? 'Stays on this computer.' : 'Saved by AppBlips on this computer, not in the browser.'}
            <a href={keyUrl} target="_blank" rel="noopener noreferrer">Get a key <ArrowUpRight size={15} /></a>
          </p>
        )}
        {!provider.local && isDesktop && weakEncryption && (
          <p className="onboarding-key-warning">A system keychain was not found. Install GNOME Keyring or KWallet for stronger protection.</p>
        )}
      </SetupField>

      <SetupField title="Model" error={errors.model}>
        <div data-field="model">
          <ModelCombobox
            value={model}
            onChange={setModel}
            models={modelList.models}
            loading={modelList.loading}
            allowCustom
            placeholder="Select a model or enter its ID…"
            canOpen={canOpenModels}
          />
        </div>
        {modelList.error && <p className="onboarding-key-help" role="status">{modelList.error} Type a model ID to continue.</p>}
      </SetupField>
      {needKey && <NeedKeyModal providerLabel={provider.label} onClose={closeNeedKey} />}
    </form>
  );
}

const PLAN_OPTIONS = [
  { id: 'key', Icon: KeyRound, title: 'Bring my own API key', text: 'Use your Anthropic, OpenAI, Gemini, DeepSeek or OpenRouter account, or LM Studio or Ollama on this computer. Your provider bills you.' },
  { id: 'credits', Icon: Coins, title: 'Use AppBlips AI Credits', text: 'No API key or AI account needed. Connect the credits you already have, or start a free trial or buy a pack next.' },
];

const CREDITS_OPTIONS = [
  { id: 'new', Icon: Sparkles, title: 'I’m new to AI Credits', text: 'See the plans on appblips.com and start a free 3-day trial or buy a credit pack.' },
  { id: 'existing', Icon: Mail, title: 'I already have AI Credits', text: 'You started a trial or bought a pack. Connect it with the email you used at checkout.' },
];

// A radio group drawn as cards; arrow keys move through it like the avatar grid.
function ChoiceCards({ formRef, label, options, value, onChange }) {
  const pick = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length].id;
    onChange(next);
    formRef.current?.querySelector(`[data-choice="${next}"]`)?.focus();
  };

  return (
    <div className="onboarding-plan-list" role="radiogroup" aria-label={label}>
      {options.map(({ id, Icon, title, text }, index) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
          data-choice={id}
          className={`onboarding-plan ${value === id ? 'is-selected' : ''}`}
          onClick={() => onChange(id)}
          onKeyDown={(event) => pick(event, index)}
          autoFocus={value === id}
        >
          <span className="onboarding-plan-icon"><Icon size={20} /></span>
          <span className="onboarding-plan-copy"><strong>{title}</strong><small>{text}</small></span>
          <span className="onboarding-model-radio">{value === id && <Check size={12} strokeWidth={3} />}</span>
        </button>
      ))}
    </div>
  );
}

// Third slide: how the AI is paid for. It only picks which form comes next;
// nothing is saved until that form is finished.
function PlanForm({ formRef, onSubmit, plan, setPlan }) {
  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <SetupField title="Make a selection:">
        <ChoiceCards formRef={formRef} label="How do you want to use AI?" options={PLAN_OPTIONS} value={plan} onChange={setPlan} />
        <p className="onboarding-key-help">You can switch any time in Settings → API.</p>
      </SetupField>
    </form>
  );
}

// Fourth slide when credits were chosen: new customers go to the website to
// sign up and pay (Polar checkout); existing ones go on to ConnectCreditsForm.
function CreditsForm({ formRef, onSubmit, choice, setChoice, openedPricing }) {
  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <SetupField title="Make a selection:">
        <ChoiceCards formRef={formRef} label="Do you already have AI Credits?" options={CREDITS_OPTIONS} value={choice} onChange={setChoice} />
        {choice === 'new' && (
          <p className="onboarding-key-help" role={openedPricing ? 'status' : undefined}>
            {openedPricing
              ? 'The plans opened in your web browser. When you’ve finished checkout, choose I already have AI Credits.'
              : 'Click Continue to see pricing and sign up on our website.'}
          </p>
        )}
      </SetupField>
    </form>
  );
}

// Last slide for existing credits customers. Connecting takes the checkout
// email plus the code then sent to it, so knowing someone's email isn't
// enough to spend their credits.
function ConnectCreditsForm({ formRef, onSubmit, email, setEmail, error, codeSentTo, code, setCode, codeError, onResend, onChangeEmail, busy }) {
  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      {codeSentTo && (
        <SetupField title="Code from the email" error={codeError}>
          <span className="onboarding-key-input">
            <KeyRound size={19} />
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste the code"
              aria-label="Code from the email"
              aria-invalid={Boolean(codeError)}
              data-field="code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              autoFocus
            />
          </span>
          <p className="onboarding-key-help" role="status">
            We sent a sign-in code to <strong>{codeSentTo}</strong>. It comes from Polar, our payment service, and can take a minute to arrive.
          </p>
          <p className="onboarding-key-help onboarding-inline-actions">
            <button type="button" onClick={onResend} disabled={busy}>Send a new code</button>
            <button type="button" onClick={onChangeEmail} disabled={busy}>Use a different email</button>
          </p>
        </SetupField>
      )}

      {!codeSentTo && (
        <SetupField title="Checkout email" error={error}>
          <span className="onboarding-key-input">
            <Mail size={19} />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="The email you used at checkout"
              aria-label="Checkout email"
              aria-invalid={Boolean(error)}
              data-field="email"
              autoComplete="email"
              spellCheck={false}
              className="onboarding-name-input"
              autoFocus
            />
          </span>
          <p className="onboarding-key-help">We’ll email you a code to prove it’s you.</p>
        </SetupField>
      )}

      <p className="onboarding-key-help">
        Having trouble connecting?
        <a href="mailto:support@appblips.com" target="_blank" rel="noopener noreferrer">support@appblips.com <Mail size={15} /></a>
      </p>
    </form>
  );
}

// First slide: only the user's name, so the opening question is a single box.
function NameForm({ formRef, onSubmit, name, setName, errors }) {
  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <SetupField title="Your name" error={errors.name}>
        <span className="onboarding-key-input">
          <UserRound size={19} />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What should we call you?"
            aria-label="Your name"
            aria-invalid={Boolean(errors.name)}
            data-field="name"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="given-name"
            className="onboarding-name-input"
            autoFocus
          />
        </span>
      </SetupField>
    </form>
  );
}

// Second slide: the chat avatar and (desktop only) where projects are saved.
// The folder picker is the same one as Settings → Data, so the main process
// still decides whether existing projects move.
function AvatarForm({ formRef, onSubmit, avatar, setAvatar, folder, onChooseFolder, folderStatus }) {
  const pickAvatar = (event, index) => {
    // Arrow keys move through the grid like a radio group.
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = AVATAR_IDS[(index + step + AVATAR_IDS.length) % AVATAR_IDS.length];
    setAvatar(next);
    formRef.current?.querySelector(`[data-avatar="${next}"]`)?.focus();
  };

  return (
    <form ref={formRef} className="desktop-onboarding-setup" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <SetupField title="Your avatar">
        <div className="onboarding-avatar-grid" role="radiogroup" aria-label="Your avatar">
          {AVATAR_IDS.map((id, index) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={avatar === id}
              aria-label={AVATAR_LABELS[id]}
              title={AVATAR_LABELS[id]}
              tabIndex={avatar === id ? 0 : -1}
              data-avatar={id}
              className={`onboarding-avatar ${avatar === id ? 'is-selected' : ''}`}
              onClick={() => setAvatar(id)}
              onKeyDown={(event) => pickAvatar(event, index)}
            >
              <ProfileAvatar avatar={id} size={22} />
            </button>
          ))}
        </div>
        <p className="onboarding-key-help">Shown next to your messages in the chat.</p>
      </SetupField>

      {isDesktop && (
        <SetupField title="Save projects in">
          <span className="onboarding-folder">
            <FolderOpen size={19} />
            <span className="onboarding-folder-path" title={folder || ''}>{folder || '…'}</span>
            <button type="button" onClick={onChooseFolder}>Change</button>
          </span>
          <p className={`onboarding-key-help ${folderStatus?.kind === 'error' ? 'is-error' : ''}`} role={folderStatus ? 'status' : undefined}>
            {folderStatus?.text || 'Each project gets its own folder here.'}
          </p>
        </SetupField>
      )}
    </form>
  );
}

// `onExit` is only passed when onboarding is replayed from Settings: the user
// already has (or deliberately skipped) a setup, so they may leave without
// re-entering a key. A first run offers "Skip for now" instead, which saves
// that onboarding is done so it doesn't come back on the next launch.
export default function DesktopOnboarding({ providerInfo, onComplete: finishSetup, onExit: exitSetup }) {
  const [step, setStep] = useState('name');
  const [profile] = useState(loadProfile);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar || AVATAR_IDS[0]);
  const [profileAttempted, setProfileAttempted] = useState(false);
  const [folder, setFolder] = useState(null);
  const [folderStatus, setFolderStatus] = useState(null);
  // The renderer's copy of the projects was read from the old folder, so a
  // change reloads the app once setup is over (it won't show again then: the
  // AI setup or the skip is saved first).
  const [folderChanged, setFolderChanged] = useState(false);
  const leave = (done) => (folderChanged ? () => window.location.reload() : done);
  const onComplete = leave(finishSetup);
  const onExit = exitSetup && leave(exitSetup);
  const [providerId, setProviderId] = useState(providerInfo?.id || defaultProvider.id);
  const provider = USER_PROVIDER_OPTIONS.find((option) => option.id === providerId) || defaultProvider;
  const [baseUrl, setBaseUrl] = useState(providerInfo?.baseUrl || '');
  const changeProvider = (id) => { setProviderId(id); setModel(''); setApiKey(''); setBaseUrl(''); };
  const [model, setModel] = useState(
    (providerInfo?.id === provider.id && providerInfo?.model) || provider.models[0]?.id || '',
  );
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [plan, setPlan] = useState('key');
  const [creditsChoice, setCreditsChoice] = useState('new');
  const [openedPricing, setOpenedPricing] = useState(false);
  const [confirmWebsite, setConfirmWebsite] = useState(false);
  const [creditsEmail, setCreditsEmail] = useState('');
  const [creditsError, setCreditsError] = useState('');
  // The email the sign-in code went to; empty until one is sent.
  const [codeSentTo, setCodeSentTo] = useState('');
  const [creditsCode, setCreditsCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [status, setStatus] = useState(null);
  // Set when "Start building" is pressed with fields missing; from then on the
  // missing fields stay marked until they are filled in.
  const [attempted, setAttempted] = useState(false);
  const titleRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (isDesktop) desktopBridge.folder.get().then(setFolder).catch((err) => logWarn('Could not read the projects folder location', err));
  }, []);

  const chooseFolder = async () => {
    try {
      const result = await desktopBridge.folder.choose();
      if (!result.changed) return;
      setFolder(result.root);
      setFolderChanged(true);
      setFolderStatus({ kind: 'ok', text: result.moved ? `Folder changed. Moved ${result.moved} ${result.moved === 1 ? 'project' : 'projects'}.` : 'Folder changed.' });
    } catch (err) {
      logError('Could not change the projects folder during setup', err);
      setFolderStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not change the folder.' });
    }
  };

  const needsName = !cleanName(name);
  const profileErrors = profileAttempted && needsName ? { name: 'Type your name, or a nickname.' } : {};
  // Saved as each slide is left, so a skip on a later slide keeps the name.
  const keepProfile = () => {
    try {
      saveProfile({ name, avatar });
    } catch (err) {
      // Only the chat name and avatar are lost; setup itself can go on.
      logWarn('Could not save the name and avatar', err);
    }
  };
  const continueToAvatar = () => {
    if (needsName) {
      setProfileAttempted(true);
      formRef.current?.querySelector('[data-field="name"]')?.focus();
      return;
    }
    keepProfile();
    setStep('avatar');
  };
  const continueToPlan = () => {
    keepProfile();
    setStep('plan');
  };
  const continueFromPlan = () => setStep(plan === 'credits' ? 'credits' : 'ai');

  const needsKey = !provider.local && !apiKey.trim();
  const needsModel = !model.trim();
  const errors = attempted ? {
    key: needsKey ? `Paste your ${provider.label} API key here.` : '',
    model: needsModel ? 'Choose a model, or type its ID.' : '',
  } : {};
  const busy = status?.kind === 'busy' || status?.kind === 'ok';

  const save = async () => {
    if (busy) return;
    if (needsKey || needsModel) {
      setAttempted(true);
      const first = formRef.current?.querySelector(needsKey ? '[data-field="key"]' : '[data-field="model"] input');
      first?.focus();
      return;
    }
    setStatus({ kind: 'busy', text: 'Saving your AI setup…' });
    try {
      await providerApi.set({ enabled: true, id: provider.id, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setStatus({ kind: 'ok', text: 'You’re ready.' });
      window.setTimeout(onComplete, 350);
    } catch (error) {
      logError(`Could not save the AI setup (${provider.id})`, error);
      setStatus({ kind: 'error', text: ipcErrorMessage(error) || 'Could not save your AI setup.' });
    }
  };

  const markOnboarded = async () => {
    try {
      await providerApi.set({ onboardingComplete: true });
    } catch (err) {
      // Not remembering this only means setup shows again next launch.
      logWarn('Could not remember that AI setup was done', err);
    }
  };

  const skip = async () => {
    if (busy) return;
    await markOnboarded();
    onComplete();
  };

  // Credits need no provider entry: the chat proxy uses them whenever no
  // provider of the user's own is set (handleChatProxy in chatProxy.js).
  const openPricing = () => {
    try { window.open(PRICING_URL, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
    setOpenedPricing(true);
  };

  const finishCredits = async () => {
    await markOnboarded();
    setStatus({ kind: 'ok', text: 'You’re ready.' });
    window.setTimeout(onComplete, 350);
  };

  const sendCreditsCode = async () => {
    const email = creditsEmail.trim();
    if (!email) {
      setCreditsError('Enter the email address you used at checkout.');
      formRef.current?.querySelector('[data-field="email"]')?.focus();
      return;
    }
    setCreditsError('');
    setCodeError('');
    setStatus({ kind: 'busy', text: 'Sending your code…' });
    const res = await creditsConnect(email);
    if (res.error) {
      setStatus(null);
      if (codeSentTo) setCodeError(res.error);
      else setCreditsError(res.error);
      return;
    }
    if (res.signedIn) return finishCredits();
    setStatus(null);
    setCreditsCode('');
    setCodeSentTo(res.email || email);
  };

  const continueFromCredits = () => {
    if (creditsChoice === 'new') setConfirmWebsite(true);
    else setStep('connect');
  };

  const connectCredits = async () => {
    if (busy) return;
    if (!codeSentTo) return sendCreditsCode();
    if (!creditsCode.trim()) {
      setCodeError('Paste the code from the email.');
      formRef.current?.querySelector('[data-field="code"]')?.focus();
      return;
    }
    setCodeError('');
    setStatus({ kind: 'busy', text: 'Connecting your credits…' });
    const res = await creditsVerify(codeSentTo, creditsCode);
    if (res.error) {
      setStatus(null);
      setCodeError(res.error);
      formRef.current?.querySelector('[data-field="code"]')?.focus();
      return;
    }
    return finishCredits();
  };

  const isName = step === 'name';
  const isAvatar = step === 'avatar';
  const isPlan = step === 'plan';
  const isAi = step === 'ai';
  const isCredits = step === 'credits';
  const isConnect = step === 'connect';
  const isLast = isAi || isConnect;
  const back = { avatar: 'name', plan: 'avatar', ai: 'plan', credits: 'plan', connect: 'credits' }[step];
  // The credits path has one more slide than the own-key path.
  const stepCount = plan === 'credits' ? 5 : 4;
  const stepNumber = { avatar: 2, plan: 3, ai: 4, credits: 4, connect: 5 }[step];

  return (
    <div className="desktop-onboarding" role="dialog" aria-modal="true" aria-labelledby="desktop-onboarding-title">
      <div className="onboarding-backdrop" aria-hidden="true"><i /><i /><i /></div>
      <main className="desktop-onboarding-card is-setup">
        <header className="onboarding-topbar">
          <div className="onboarding-brand">
            <img src="/favicon.svg" alt="" aria-hidden="true" className="onboarding-brand-icon" />
            <img src="/appblips-wordmark-dark.svg" alt="AppBlips" />
          </div>
          {onExit ? (
            <button type="button" className="onboarding-exit" onClick={onExit} disabled={status?.kind === 'busy'}>
              Exit setup <X size={15} />
            </button>
          ) : (
            <span><Laptop size={20} /> {isDesktop ? 'Desktop setup' : 'Setup'}</span>
          )}
        </header>

        <div className="onboarding-stage" key={step}>
          <section className="onboarding-copy has-panel">
            <span className="onboarding-eyebrow"><Sparkles size={14} /> {isName ? 'Welcome to AppBlips' : `Step ${stepNumber} of ${stepCount}`}</span>
            {!isName && cleanName(name) && (
              <div className="onboarding-greeting">
                <ProfileAvatar avatar={avatar} size={22} />
                <span>Hi, {cleanName(name)}</span>
              </div>
            )}
            {isName ? (
              <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
                First, what should <span className="onboarding-title-accent">we call you?</span>
              </h1>
            ) : isAvatar ? (
              <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
                Now pick <span className="onboarding-title-accent">your avatar.</span>
              </h1>
            ) : isPlan ? (
              <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
                How do you want to <span className="onboarding-title-accent">power AppBlips?</span>
              </h1>
            ) : isCredits ? (
              <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
                Build with <span className="onboarding-title-accent">AppBlips AI Credits.</span>
              </h1>
            ) : isConnect ? (
              <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
                Connect your <span className="onboarding-title-accent">AI Credits.</span>
              </h1>
            ) : (
              <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>
                Choose the AI that <span className="onboarding-title-accent">builds with you.</span>
              </h1>
            )}
            {isName ? (
              <p>Type your name or a nickname. It appears next to your messages in the chat.</p>
            ) : isAvatar ? (
              <p>{isDesktop
                ? 'Pick a fun avatar for your chat messages, and choose where your projects are saved. You can change these later by replaying onboarding in Settings.'
                : 'Pick a fun avatar for your chat messages.'}</p>
            ) : isPlan ? (
              <p>AppBlips needs an AI to build with. Use your own API key from an AI provider, or use AppBlips AI Credits instead of a key.</p>
            ) : isCredits ? (
              <p>New here? See the plans and sign up on our website. Already signed up? Connect the credits you bought on the next screen.</p>
            ) : isConnect ? (
              <p>Enter the email you used at checkout. We’ll email you a code to prove it’s you, so nobody else can use your credits.</p>
            ) : (
              <p>Connect through Anthropic, OpenAI, Gemini, DeepSeek, or OpenRouter, or use LM Studio or Ollama on this computer. You can change this later in Settings.</p>
            )}
          </section>
          <section className="onboarding-visual-wrap">
            {isName ? (
              <NameForm formRef={formRef} onSubmit={continueToAvatar} {...{ name, setName }} errors={profileErrors} />
            ) : isAvatar ? (
              <AvatarForm
                formRef={formRef}
                onSubmit={continueToPlan}
                {...{ avatar, setAvatar, folder, folderStatus }}
                onChooseFolder={chooseFolder}
              />
            ) : isPlan ? (
              <PlanForm formRef={formRef} onSubmit={continueFromPlan} {...{ plan, setPlan }} />
            ) : isCredits ? (
              <CreditsForm
                formRef={formRef}
                onSubmit={continueFromCredits}
                choice={creditsChoice}
                setChoice={setCreditsChoice}
                openedPricing={openedPricing}
              />
            ) : isConnect ? (
              <ConnectCreditsForm
                formRef={formRef}
                onSubmit={connectCredits}
                codeSentTo={codeSentTo}
                code={creditsCode}
                setCode={(value) => { setCreditsCode(value); setCodeError(''); }}
                codeError={codeError}
                onResend={sendCreditsCode}
                onChangeEmail={() => { setCodeSentTo(''); setCreditsCode(''); setCodeError(''); }}
                busy={busy}
                email={creditsEmail}
                setEmail={(value) => { setCreditsEmail(value); setCreditsError(''); }}
                error={creditsError}
              />
            ) : (
              <SetupForm
                formRef={formRef}
                onSubmit={save}
                provider={provider}
                setProviderId={changeProvider}
                {...{ baseUrl, setBaseUrl, model, setModel, apiKey, setApiKey, showKey, setShowKey, errors }}
                weakEncryption={providerInfo?.weakEncryption}
              />
            )}
          </section>
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-footer-start">
            {back && (
              <button type="button" className="onboarding-skip" onClick={() => { setStatus(null); setStep(back); }} disabled={busy}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            {!onExit && (
              <button type="button" className="onboarding-skip" onClick={skip} disabled={busy}>
                Skip for now
              </button>
            )}
          </div>
          <div className="onboarding-actions">
            {isLast && status?.kind === 'error' && <span className="onboarding-error" role="alert"><CircleAlert size={15} /> {status.text}</span>}
            {!isLast ? (
              <button type="button" className="onboarding-next" onClick={isName ? continueToAvatar : isAvatar ? continueToPlan : isPlan ? continueFromPlan : continueFromCredits}>
                Continue <ArrowRight size={18} />
              </button>
            ) : (
              <button
                type="button"
                className="onboarding-next"
                onClick={isConnect ? connectCredits : save}
                disabled={busy}
              >
                {status?.kind === 'busy' ? <Loader2 className="animate-spin" size={18} /> : status?.kind === 'ok' && <Check size={18} />}
                {busy ? status.text : <>{!isConnect ? 'Start building' : codeSentTo ? 'Use my credits' : 'Email me a code'} <ArrowRight size={18} /></>}
              </button>
            )}
          </div>
        </footer>
      </main>
      {confirmWebsite && (
        <OpenWebsiteModal
          onOpen={() => { setConfirmWebsite(false); openPricing(); }}
          onClose={() => setConfirmWebsite(false)}
        />
      )}
    </div>
  );
}
