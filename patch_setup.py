import sys

with open("src/components/DesktopOnboarding.jsx", "r") as f:
    content = f.read()

old_setup = """function SetupVisual({ model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption }) {
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
}"""

new_setup = """function SetupVisual({ model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption }) {
  const [fetchedModels, setFetchedModels] = useState([]);

  useEffect(() => {
    fetch('https://openrouter.ai/api/v1/models')
      .then((res) => res.json())
      .then((data) => {
        if (data?.data) {
          setFetchedModels(data.data.map((m) => ({ id: m.id, label: m.name })).sort((a, b) => a.label.localeCompare(b.label)));
        }
      })
      .catch((err) => console.error('Failed to fetch OpenRouter models:', err));
  }, []);

  return (
    <div className="desktop-onboarding-setup flex flex-col h-full bg-[#111827]/60">
      <div className="onboarding-setup-heading">
        <span className="onboarding-setup-icon"><Bot size={23} /></span>
        <span><strong>OpenRouter</strong><small>One key, your choice of leading models</small></span>
        <span className="onboarding-private-badge"><LockKeyhole size={12} /> Private</span>
      </div>

      <fieldset className="onboarding-model-fieldset flex flex-col gap-2 !pb-2">
        <label className="text-sm font-semibold text-slate-200">Choose your model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full mt-1.5 p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        >
          <option value="" className="bg-slate-900 text-slate-200">
            {fetchedModels.length === 0 ? 'Loading models…' : 'Select a coding model…'}
          </option>
          {(fetchedModels.length > 0 ? fetchedModels : provider.models).map((m) => (
            <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">{m.label}</option>
          ))}
        </select>
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
        {isDesktop ? 'Your key stays on this computer and is encrypted with your system keychain.' : 'Your key is stored locally in your browser and is never sent to our servers.'}{' '}
        <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">Create an OpenRouter key</a>
      </p>
      {isDesktop && weakEncryption && (
        <p className="onboarding-key-warning">A system keychain was not found. Install GNOME Keyring or KWallet for stronger protection.</p>
      )}
    </div>
  );
}"""

content = content.replace(old_setup, new_setup)
with open("src/components/DesktopOnboarding.jsx", "w") as f:
    f.write(content)
