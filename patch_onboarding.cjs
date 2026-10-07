const fs = require('fs');
const file = fs.readFileSync('src/components/DesktopOnboarding.jsx', 'utf8');

let newFile = file.replace(
  "import { desktopBridge, ipcErrorMessage, providerApi } from '../lib/desktop';",
  "import { desktopBridge, ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';"
);

newFile = newFile.replace(
  "function SetupVisual({ model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption }) {",
  `function SetupVisual({ model, setModel, apiKey, setApiKey, showKey, setShowKey, weakEncryption }) {
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
  }, []);`
);

newFile = newFile.replace(
  /<fieldset className="onboarding-model-fieldset">[\s\S]*?<\/fieldset>/,
  `<fieldset className="onboarding-model-fieldset flex flex-col gap-2">
        <label className="text-sm font-semibold text-slate-200">Choose your model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full mt-1.5 p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        >
          <option value="">{fetchedModels.length === 0 ? 'Loading models…' : 'Select a coding model…'}</option>
          {(fetchedModels.length > 0 ? fetchedModels : provider.models).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </fieldset>`
);

newFile = newFile.replace(
  /Your key stays on this computer and is encrypted with your system keychain./,
  `{isDesktop ? 'Your key stays on this computer and is encrypted with your system keychain.' : 'Your key is stored locally in your browser and is never sent to our servers.'}`
);

newFile = newFile.replace(
  /{weakEncryption && \([\s\S]*?gnome keyring[\s\S]*?}\)/i,
  `{isDesktop && weakEncryption && (
        <p className="onboarding-key-warning">A system keychain was not found. Install GNOME Keyring or KWallet for stronger protection.</p>
      )}`
);

fs.writeFileSync('src/components/DesktopOnboarding.jsx', newFile);
