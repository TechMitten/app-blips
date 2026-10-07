import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bot, Check, CircleAlert, Code2, Eye, EyeOff,
  Gamepad2, KeyRound, Layers3, Loader2, LockKeyhole, MonitorSmartphone,
  MousePointer2, Palette, Rocket, Smartphone, Sparkles, WandSparkles,
} from 'lucide-react';
import { desktopBridge, ipcErrorMessage } from '../lib/desktop';
import { USER_PROVIDER_OPTIONS } from '../../functions/_lib/providers.js';

const provider = USER_PROVIDER_OPTIONS.find((option) => option.id === 'openrouter');

const modelNotes = {
  '~anthropic/claude-sonnet-latest': 'Polished UI and strong all-round coding',
  '~openai/gpt-sol-latest': 'Powerful reasoning for complex builds',
  '~google/gemini-pro-latest': 'Strong planning and large-context work',
  '~openai/gpt-mini-latest': 'A quick, lower-cost everyday choice',
  '~google/gemini-flash-latest': 'Fast iteration and lightweight builds',
};

function IdeaVisual() {
  return (
    <div className="desktop-onboarding-visual idea-visual" aria-hidden="true">
      <div className="onboarding-prompt-card">
        <span className="onboarding-avatar"><Sparkles size={17} /></span>
        <span>Build a calm habit tracker with weekly insights</span>
        <span className="onboarding-send"><ArrowRight size={15} /></span>
      </div>
      <div className="onboarding-build-line"><span /><WandSparkles size={20} /><span /></div>
      <div className="onboarding-app-window">
        <div className="onboarding-window-bar"><i /><i /><i /><b>My habits</b></div>
        <div className="onboarding-window-body">
          <div className="onboarding-mini-sidebar"><i /><i /><i /></div>
          <div className="onboarding-mini-content">
            <span className="onboarding-kicker">GOOD MORNING</span>
            <strong>Small steps, real progress.</strong>
            <div className="onboarding-stat-row"><i /><i /><i /></div>
            <div className="onboarding-chart"><span /><span /><span /><span /><span /><span /><span /></div>
          </div>
        </div>
        <span className="onboarding-live-pill"><i /> Live preview</span>
      </div>
    </div>
  );
}

function WorkflowVisual() {
  return (
    <div className="desktop-onboarding-visual workflow-visual" aria-hidden="true">
      <div className="onboarding-orbit orbit-one" />
      <div className="onboarding-orbit orbit-two" />
      <div className="onboarding-center-mark"><Layers3 size={31} /></div>
      <div className="onboarding-float-card float-app"><Smartphone size={21} /><span>App</span></div>
      <div className="onboarding-float-card float-site"><MonitorSmartphone size={21} /><span>Website</span></div>
      <div className="onboarding-float-card float-game"><Gamepad2 size={21} /><span>Game</span></div>
      <div className="onboarding-tool-chip tool-palette"><Palette size={15} /> Click to edit</div>
      <div className="onboarding-tool-chip tool-code"><Code2 size={15} /> Own the code</div>
      <div className="onboarding-tool-chip tool-ship"><Rocket size={15} /> Publish</div>
      <MousePointer2 className="onboarding-cursor" size={25} />
    </div>
  );
}

function SetupVisual({ model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption }) {
  return (
    <div className="desktop-onboarding-setup">
      <div className="onboarding-setup-heading">
        <span className="onboarding-setup-icon"><Bot size={23} /></span>
        <span><strong>OpenRouter</strong><small>One key, your choice of leading models</small></span>
        <span className="onboarding-private-badge"><LockKeyhole size={12} /> Private</span>
      </div>

      <fieldset className="onboarding-model-fieldset">
        <legend>Choose your model</legend>
        <div className="onboarding-model-list">
          {provider.models.map((option, index) => (
            <label key={option.id} className={`onboarding-model-option ${model === option.id ? 'is-selected' : ''}`}>
              <input type="radio" name="onboarding-model" value={option.id} checked={model === option.id} onChange={() => setModel(option.id)} />
              <span className="onboarding-model-radio">{model === option.id && <Check size={13} />}</span>
              <span className="onboarding-model-copy">
                <strong>{option.label}</strong>
                <small>{modelNotes[option.id]}</small>
              </span>
              {index === 0 && <span className="onboarding-recommended">Recommended</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="onboarding-key-label">
        <span>OpenRouter API key</span>
        <span className="onboarding-key-input">
          <KeyRound size={17} />
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      <p className="onboarding-key-help">
        Your key stays on this computer and is encrypted with your system keychain.{' '}
        <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">Create an OpenRouter key</a>
      </p>
      {weakEncryption && (
        <p className="onboarding-key-warning">A system keychain was not found. Install GNOME Keyring or KWallet for stronger protection.</p>
      )}
    </div>
  );
}

const slides = [
  {
    eyebrow: 'Welcome to AppBlips',
    title: 'Turn an idea into something you can use.',
    body: 'Describe what you want in plain English. AppBlips designs it, writes the code and brings it to life in a real preview.',
    visual: <IdeaVisual />,
  },
  {
    eyebrow: 'Build your way',
    title: 'Create, refine and ship — all in one place.',
    body: 'Make apps, responsive websites and browser games. Edit visually, keep iterating in chat, then export or publish when it feels right.',
    visual: <WorkflowVisual />,
  },
];

export default function DesktopOnboarding({ providerInfo, onComplete }) {
  const [step, setStep] = useState(0);
  const [model, setModel] = useState(provider.models[0]?.id || '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null);
  const titleRef = useRef(null);
  const setup = step === slides.length;
  const total = slides.length + 1;

  useEffect(() => { titleRef.current?.focus(); }, [step]);

  const save = async () => {
    if (!model || !apiKey.trim()) return;
    setStatus({ kind: 'busy', text: 'Securing your key…' });
    try {
      await desktopBridge.provider.set({ enabled: true, id: provider.id, model, apiKey: apiKey.trim() });
      setStatus({ kind: 'ok', text: 'You’re ready.' });
      window.setTimeout(onComplete, 350);
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) || 'Could not save your AI setup.' });
    }
  };

  const content = setup ? {
    eyebrow: 'One last step',
    title: 'Choose the AI that builds with you.',
    body: 'AppBlips connects through OpenRouter, so you stay in control of the model and usage. You can change this later in Settings.',
  } : slides[step];

  return (
    <div className="desktop-onboarding" role="dialog" aria-modal="true" aria-labelledby="desktop-onboarding-title">
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="onboarding-logo-key" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 3 3 0 0" />
        </filter>
      </svg>
      <div className="onboarding-backdrop" aria-hidden="true"><i /><i /><i /></div>
      <main className={`desktop-onboarding-card ${setup ? 'is-setup' : ''}`}>
        <header className="onboarding-topbar">
          <img src="/newlog.webp" alt="AppBlips" />
          <span>Desktop setup</span>
        </header>

        <div className="onboarding-stage" key={step}>
          <section className="onboarding-copy">
            <span className="onboarding-eyebrow"><Sparkles size={14} /> {content.eyebrow}</span>
            <h1 id="desktop-onboarding-title" ref={titleRef} tabIndex={-1}>{content.title}</h1>
            <p>{content.body}</p>
            {!setup && (
              <div className="onboarding-benefits">
                {step === 0 ? (
                  <><span><Check size={14} /> No coding required</span><span><Check size={14} /> Your projects stay local</span></>
                ) : (
                  <><span><Check size={14} /> Visual editing</span><span><Check size={14} /> Export anytime</span></>
                )}
              </div>
            )}
          </section>
          <section className="onboarding-visual-wrap">
            {setup
              ? <SetupVisual {...{ model, setModel, apiKey, setApiKey, showKey, setShowKey }} weakEncryption={providerInfo?.weakEncryption} />
              : content.visual}
          </section>
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${total}`}>
            {Array.from({ length: total }, (_, index) => <span key={index} className={index === step ? 'is-active' : index < step ? 'is-done' : ''} />)}
          </div>
          <div className="onboarding-actions">
            {step > 0 && status?.kind !== 'busy' && (
              <button type="button" className="onboarding-back" onClick={() => { setStep((value) => value - 1); setStatus(null); }}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            {status?.kind === 'error' && <span className="onboarding-error" role="alert"><CircleAlert size={15} /> {status.text}</span>}
            {setup ? (
              <button type="button" className="onboarding-next" onClick={save} disabled={!model || !apiKey.trim() || status?.kind === 'busy' || status?.kind === 'ok'}>
                {status?.kind === 'busy' ? <Loader2 className="animate-spin" size={17} /> : status?.kind === 'ok' ? <Check size={17} /> : <Rocket size={17} />}
                {status?.kind === 'busy' ? status.text : status?.kind === 'ok' ? status.text : 'Start building'}
              </button>
            ) : (
              <button type="button" className="onboarding-next" onClick={() => setStep((value) => value + 1)}>
                Next <ArrowRight size={17} />
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
