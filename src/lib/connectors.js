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
    // Shown by the "How it works" dialog on the connector's settings page.
    // Every connector needs one; keep it plain-language and in step with docs.
    about: {
      what: 'Web3Forms lets the forms in your websites and apps email their entries to you, so a contact form works without you building or paying for a server.',
      steps: [
        'Sign up for free at web3forms.com with the email address you want entries sent to. Web3Forms emails you an access key.',
        'Turn on Web3Forms here and paste the access key into the Access key box.',
        'From then on, when the AI builds or edits a Responsive Website or a Mobile & Web App, it sets up contact, signup and booking forms to use your key.',
        'When someone fills in one of those forms and presses send, the entry goes to Web3Forms, which emails it to you. The form shows a message on the page saying it was sent, or what went wrong.',
      ],
      notes: [
        'Forms send real emails from the preview too, so a test entry there lands in your inbox.',
        'Your access key is written into the code of your forms and any HTML you export. That is how Web3Forms is designed: the key can only send email to your own inbox.',
        'Projects built before you connected don’t change on their own. Ask the AI to “make the contact form use Web3Forms”.',
        'The Browser Game studio doesn’t use it.',
        'Web3Forms is a separate service with its own free plan and limits.',
      ],
    },
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
