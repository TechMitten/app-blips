// Connectors: third-party services the user links in Settings → Connectors so
// the AI can wire them into new projects. Framework-free (llm.js reads it at
// generation time; the settings UI reads and writes it).
//
// Only public values live here. Web3Forms' access key is designed to sit in a
// page's HTML (it can only deliver mail to its owner's inbox), so it is kept in
// localStorage like the other settings and written into the generated code.
// Anything secret would need the main-process store the AI provider key uses.
import { safeStorage } from './config.js';

export const CONNECTORS_KEY = 'orion-connectors';

// The key Web3Forms emails to the user: a UUID.
const WEB3FORMS_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONNECTOR_DEFINITIONS = {
  web3forms: {
    id: 'web3forms',
    name: 'Web3Forms',
    tagline: 'Email form submissions to you',
    description: 'A form backend. Contact, signup and booking forms in your websites and apps send their entries to your inbox.',
    keyLabel: 'Access key',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    keyUrl: 'https://web3forms.com',
    isValidKey: (key) => WEB3FORMS_KEY_RE.test(key),
  },
};

export const CONNECTOR_IDS = Object.keys(CONNECTOR_DEFINITIONS);

// { [id]: { enabled: boolean, key: string } } for every known connector.
export const loadConnectors = () => {
  let stored = {};
  try {
    const parsed = JSON.parse(safeStorage('local')?.getItem(CONNECTORS_KEY) || '{}');
    if (parsed && typeof parsed === 'object') stored = parsed;
  } catch { /* unreadable: treat as nothing connected */ }
  return Object.fromEntries(CONNECTOR_IDS.map((id) => [id, {
    enabled: stored[id]?.enabled === true,
    key: typeof stored[id]?.key === 'string' ? stored[id].key : '',
  }]));
};

export const saveConnectors = (connectors) => {
  try {
    safeStorage('local')?.setItem(CONNECTORS_KEY, JSON.stringify(connectors));
  } catch { /* storage blocked: the setting just won't persist */ }
};

// 'connected' (on, valid key: used by the AI), 'needs-key' (on, key missing or
// malformed: not used yet) or 'off'.
export const connectorStatus = (id, connectors = loadConnectors()) => {
  const { enabled, key } = connectors[id] || {};
  if (!enabled) return 'off';
  return CONNECTOR_DEFINITIONS[id].isValidKey(key.trim()) ? 'connected' : 'needs-key';
};

// The connectors the AI should build with: [{ id, key }].
export const getActiveConnectors = (connectors = loadConnectors()) => CONNECTOR_IDS
  .filter((id) => connectorStatus(id, connectors) === 'connected')
  .map((id) => ({ id, key: connectors[id].key.trim() }));
