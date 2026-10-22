// Connectors: third-party services the user links in Settings → Connectors so
// the AI can wire them into new projects. Framework-free (llm.js reads it at
// generation time; the settings UI reads and writes it).
//
// Only public values live here. Web3Forms' access key is designed to sit in a
// page's HTML (it can only deliver mail to its owner's inbox), and analytics
// tracking code can only add visits, so they are kept in localStorage like the
// other settings and written into the generated code.
// Anything secret would need the main-process store the AI provider key uses.
import { safeStorage } from './config.js';

export const CONNECTORS_KEY = 'orion-connectors';

// The key Web3Forms emails to the user, and an Umami website ID: both UUIDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A comma-separated list of hostnames (Plausible's data-domain, Umami's data-domains).
const DOMAINS_RE = /^[a-z0-9.-]+(,[a-z0-9.-]+)*$/i;

// The <script> tags in a pasted snippet, as lowercase-named attribute maps.
const scriptTags = (html) => [...html.matchAll(/<script\b([^>]*)>/gi)].map(([, attrs]) => Object.fromEntries(
  [...attrs.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)]
    .map(([, name, dq, sq, bare]) => [name.toLowerCase(), (dq ?? sq ?? bare).trim()]),
));

// An https URL safe to write back into an attribute, or null. The URL parser
// percent-encodes quotes and angle brackets; the final check is a backstop.
const safeHttpsUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return /["'<>\s`]/.test(url.href) ? null : url.href;
  } catch { return null; }
};

// The analytics snippets are rebuilt from the few values they need instead of
// passing the paste on, so nothing else the user pasted reaches the AI or the
// generated code. Both accept self-hosted servers. null when unusable.
const umamiSnippet = (input) => {
  if (UUID_RE.test(input)) return `<script defer src="https://cloud.umami.is/script.js" data-website-id="${input.toLowerCase()}"></script>`;
  const tag = scriptTags(input).find((attrs) => attrs['data-website-id']);
  const src = tag && safeHttpsUrl(tag.src || '');
  if (!src || !UUID_RE.test(tag['data-website-id'])) return null;
  let extra = '';
  const hostUrl = tag['data-host-url'] && safeHttpsUrl(tag['data-host-url']);
  if (hostUrl) extra += ` data-host-url="${hostUrl.replace(/\/$/, '')}"`;
  if (DOMAINS_RE.test(tag['data-domains'] || '')) extra += ` data-domains="${tag['data-domains']}"`;
  return `<script defer src="${src}" data-website-id="${tag['data-website-id'].toLowerCase()}"${extra}></script>`;
};

// Plausible's current snippet is a per-site script (/js/pa-<id>.js) plus an
// init stub (the stub is Plausible's own, from its web-snippet.js). The older
// one is any script with data-domain. Init options in a pasted snippet are
// dropped: the defaults suit generated sites.
const PLAUSIBLE_INIT = '<script>window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()</script>';
const isPlausibleSiteScript = (url) => /\/js\/pa-[\w-]+\.js$/.test(new URL(url).pathname);
const plausibleSnippet = (input) => {
  const bare = safeHttpsUrl(input);
  if (bare) return isPlausibleSiteScript(bare) ? `<script async src="${bare}"></script>\n${PLAUSIBLE_INIT}` : null;
  for (const tag of scriptTags(input)) {
    const src = safeHttpsUrl(tag.src || '');
    if (!src) continue;
    if (isPlausibleSiteScript(src)) return `<script async src="${src}"></script>\n${PLAUSIBLE_INIT}`;
    if (DOMAINS_RE.test(tag['data-domain'] || '')) return `<script defer data-domain="${tag['data-domain']}" src="${src}"></script>`;
  }
  return null;
};

// tawk.to's widget code loads https://embed.tawk.to/<property ID>/<widget ID>
// (the widget ID is often "default"). The IDs are all the paste is used for;
// the rest is tawk.to's standard loader. The IDs can't contain a quote, so
// they're safe inside its single-quoted string.
const TAWK_URL_RE = /https:\/\/embed\.tawk\.to\/([A-Za-z0-9]{8,40})\/([A-Za-z0-9_-]{1,40})(?![\w/-])/;
const tawkSnippet = (input) => {
  const match = input.match(TAWK_URL_RE);
  if (!match) return null;
  return `<!--Start of Tawk.to Script-->
<script>
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/${match[1]}/${match[2]}';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();
</script>
<!--End of Tawk.to Script-->`;
};

// The code to put in every page for an analytics or chat connector, or null.
export const embedSnippet = (id, key) => {
  if (id === 'umami') return umamiSnippet(key);
  if (id === 'plausible') return plausibleSnippet(key);
  if (id === 'tawkto') return tawkSnippet(key);
  return null;
};

const ANALYTICS_NOTES = (name) => [
  'Visits from the AppBlips preview, including the AI’s own testing, are not counted. Your exported pages count every visitor once they are online.',
  'The tracking code is written into every page and any HTML you export. That is how it is designed: anyone who sees it can only add visits to your stats, not read them.',
  `Projects built before you connected don’t change on their own. Ask the AI to “add ${name} analytics to every page”.`,
  `${name} uses no cookies, so the AI doesn’t add a cookie banner for it. Check the privacy rules where you live if you are unsure.`,
  `${name} is a separate service with its own plans and limits.`,
];

export const CONNECTOR_DEFINITIONS = {
  web3forms: {
    id: 'web3forms',
    name: 'Web3Forms',
    tagline: 'Email form submissions to you',
    description: 'A form backend. Contact, signup and booking forms in your websites and apps send their entries to your inbox.',
    keyLabel: 'Access key',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    keyUrl: 'https://web3forms.com',
    homeUrl: 'https://web3forms.com/',
    homeLinkLabel: 'Visit the Web3Forms website',
    isValidKey: (key) => UUID_RE.test(key),
    // Text for the settings page (ConnectorsSettings.jsx).
    page: {
      enableDescription: 'Forms the AI builds will send their entries to your email through Web3Forms.',
      keyHelp: 'Enter your public access key. It is meant to sit in a website’s code and only sends mail to your inbox, so it is safe to share.',
      keyLinkLabel: 'Get a free key',
      invalid: 'That doesn’t look like an access key. It has 36 characters, in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.',
      connected: 'Connected. Websites and apps you build or edit from now on will use it for their forms.',
      needsKey: 'Add your key to finish setting up.',
    },
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
  umami: {
    id: 'umami',
    name: 'Umami',
    tagline: 'Count visitors to your sites',
    description: 'Privacy-friendly visitor stats. See how many people visit your websites and apps, which pages they view and where they come from.',
    keyLabel: 'Tracking code or website ID',
    keyPlaceholder: '<script defer src="https://cloud.umami.is/script.js" data-website-id="…"></script>',
    keyUrl: 'https://umami.is',
    homeUrl: 'https://github.com/umami-software/umami',
    homeLinkLabel: 'Umami on GitHub (free to self-host)',
    multiline: true,
    isValidKey: (key) => umamiSnippet(key) !== null,
    page: {
      enableDescription: 'Websites, apps and games the AI builds will report their visits to your Umami dashboard.',
      keyHelp: 'In Umami, open your website’s settings, copy the tracking code and paste it here. Umami Cloud users can paste just the website ID. Self-hosted Umami works too.',
      keyLinkLabel: 'Sign up for Umami',
      invalid: 'That doesn’t look like Umami tracking code. Paste the whole <script> tag from your website’s settings in Umami, or its 36-character website ID.',
      connected: 'Connected. Websites, apps and games you build or edit from now on will include your tracking code.',
      needsKey: 'Add your tracking code to finish setting up.',
    },
    about: {
      what: 'Umami counts the visitors to your websites, apps and games and shows them on a dashboard: how many people came, which pages they viewed, and which sites and countries they came from. It doesn’t use cookies or collect personal data.',
      steps: [
        'Sign up at umami.is (it has a free plan) or use your own Umami server, and add your website there.',
        'Open the website’s settings in Umami and copy its tracking code.',
        'Turn on Umami here and paste the tracking code into the box.',
        'From then on, when the AI builds or edits a project in any studio, it adds the tracking code to every page.',
        'Put your project online. Each visit then shows up on your Umami dashboard.',
      ],
      notes: ANALYTICS_NOTES('Umami'),
    },
  },
  plausible: {
    id: 'plausible',
    name: 'Plausible',
    tagline: 'Count visitors to your sites',
    description: 'Privacy-friendly visitor stats. See how many people visit your websites and apps, which pages they view and where they come from.',
    keyLabel: 'Tracking code',
    keyPlaceholder: '<script async src="https://plausible.io/js/pa-….js"></script>',
    keyUrl: 'https://plausible.io',
    homeUrl: 'https://github.com/plausible/community-edition',
    homeLinkLabel: 'Plausible Community Edition on GitHub (free to self-host)',
    multiline: true,
    isValidKey: (key) => plausibleSnippet(key) !== null,
    page: {
      enableDescription: 'Websites, apps and games the AI builds will report their visits to your Plausible dashboard.',
      keyHelp: 'In Plausible, open your site’s settings, copy the tracking code from the Site installation section and paste all of it here. Self-hosted Plausible works too.',
      keyLinkLabel: 'Sign up for Plausible',
      invalid: 'That doesn’t look like Plausible tracking code. Paste everything from the Site installation section of your site’s settings in Plausible.',
      connected: 'Connected. Websites, apps and games you build or edit from now on will include your tracking code.',
      needsKey: 'Add your tracking code to finish setting up.',
    },
    about: {
      what: 'Plausible counts the visitors to your websites, apps and games and shows them on a dashboard: how many people came, which pages they viewed, and which sites and countries they came from. It doesn’t use cookies or collect personal data.',
      steps: [
        'Sign up at plausible.io (a paid service with a free trial) or use your own Plausible server, and add your site there, using the web address it will have once it is online.',
        'Open the site’s settings in Plausible and copy the tracking code from the Site installation section.',
        'Turn on Plausible here and paste the tracking code into the box.',
        'From then on, when the AI builds or edits a project in any studio, it adds the tracking code to every page.',
        'Put your project online at that address. Each visit then shows up on your Plausible dashboard.',
      ],
      notes: ANALYTICS_NOTES('Plausible'),
    },
  },
  tawkto: {
    id: 'tawkto',
    name: 'tawk.to',
    tagline: 'Live chat with your visitors',
    description: 'A free live chat bubble. Visitors to your websites and apps can message you, and you reply from the tawk.to dashboard or app.',
    keyLabel: 'Widget code',
    keyPlaceholder: '<!--Start of Tawk.to Script--> … <!--End of Tawk.to Script-->',
    keyUrl: 'https://www.tawk.to',
    multiline: true,
    isValidKey: (key) => tawkSnippet(key) !== null,
    page: {
      enableDescription: 'Websites and apps the AI builds will show a tawk.to chat bubble so visitors can message you.',
      keyHelp: 'In tawk.to, open Administration, then Chat Widget, copy the Widget Code and paste all of it here.',
      keyLinkLabel: 'Sign up for tawk.to',
      invalid: 'That doesn’t look like tawk.to widget code. Paste everything from the Widget Code box in tawk.to, from <!--Start of Tawk.to Script--> to <!--End of Tawk.to Script-->.',
      connected: 'Connected. Websites and apps you build or edit from now on will show your chat bubble.',
      needsKey: 'Add your widget code to finish setting up.',
    },
    about: {
      what: 'tawk.to adds a chat bubble to the corner of your websites and apps. Visitors click it to message you, and you answer them live from the tawk.to dashboard or its phone app. When you are away, their messages wait for you there.',
      steps: [
        'Sign up for free at tawk.to and create a property for your website.',
        'In tawk.to, open Administration, then Chat Widget, and copy the Widget Code.',
        'Turn on tawk.to here and paste the widget code into the box.',
        'From then on, when the AI builds or edits a Responsive Website or a Mobile & Web App, it adds the chat bubble to every page and keeps the bottom-right corner free for it.',
        'When a visitor sends a message, it appears in your tawk.to dashboard and app, where you can reply.',
      ],
      notes: [
        'The chat bubble works in the preview too, so a message you send there reaches your tawk.to dashboard, and preview visits show up there as visitors.',
        'Your widget code is written into every page and any HTML you export. That is how tawk.to is designed: it only lets people chat with you.',
        'Projects built before you connected don’t change on their own. Ask the AI to “add the tawk.to chat to every page”.',
        'tawk.to uses cookies to remember chats, so where the law requires it, your site may need a cookie notice.',
        'The Browser Game studio doesn’t use it.',
        'tawk.to is a separate service, free to use, with optional paid extras.',
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
