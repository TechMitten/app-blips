// Connectors: third-party services the user links in Settings → Connectors so
// the AI can wire them into new projects. Framework-free (llm.js reads it at
// generation time; the settings UI reads and writes it).
//
// Only public values live here. Web3Forms' access key is designed to sit in a
// page's HTML (it can only deliver mail to its owner's inbox), analytics
// tracking code can only add visits, and a Square Payment Link only lets people
// pay its owner, so they are kept in localStorage like the other settings and
// written into the generated code.
// Anything secret would need the main-process store the AI provider key uses.
// Pollinations is the one sign-in connector (`signIn: true`): its secret key
// lives in that kind of store (electron/server/pollinationsApi.js), and only
// the account name is kept here, as `account`. `aiPayer` says who pays for AI
// features in the user's sites: 'visitors' (their own Pollen) or 'site' (the
// user's `siteKey`). The site key is the exception to the rule above: it is
// written into every site anyway, so it is no more secret here than there.
import { safeStorage } from './config.js';
import { POLLINATIONS_EARNINGS, POLLINATIONS_FEE_NOTE } from './pollinationsApp.js';

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

// Square Payment Links: https://square.link/u/<id>, or the older long form
// https://checkout.square.site/merchant/<id>/checkout/<id>. Each line holds one
// link, optionally after the name of what it sells ("T-shirt https://…"), and
// links are also found inside Square's button code. Query strings (the button
// code adds ?src=embed) are dropped. Names can't hold markup, quotes or
// another address, since they go into the AI's instructions.
const SQUARE_URL_RE = /https:\/\/(?:square\.link\/u\/[A-Za-z0-9]{4,40}|checkout\.square\.site\/merchant\/[A-Za-z0-9]{4,40}\/checkout\/[A-Za-z0-9]{4,40})(?![\w-])/g;
const MAX_SQUARE_LINKS = 20;
export const squareLinks = (input) => {
  const links = [];
  for (const line of input.split('\n')) {
    for (const match of line.matchAll(SQUARE_URL_RE)) {
      if (links.length === MAX_SQUARE_LINKS || links.some((link) => link.url === match[0])) continue;
      const before = line.slice(0, match.index);
      const name = /[<>"'`]|:\/\//.test(before) ? '' : before.replace(/[\s:|=,–—-]+$/, '').trim().slice(0, 60);
      links.push({ name, url: match[0] });
    }
  }
  return links;
};

// Square's secret credentials: access tokens (EAAA…, or sq0atp- on old
// accounts) and application secrets (sq0csp-). Pasting one is refused with its
// own warning, since it would end up in every page.
const looksLikeSquareSecret = (input) => /\bEAAA[\w-]{20,}|\bsq0(?:atp|csp)-/.test(input);

// The code to put in every page for an analytics or chat connector, or null.
export const embedSnippet = (id, key) => {
  if (id === 'umami') return umamiSnippet(key);
  if (id === 'plausible') return plausibleSnippet(key);
  if (id === 'tawkto') return tawkSnippet(key);
  return null;
};

const ANALYTICS_PROMPTS = (name) => [
  `Add my connected ${name} analytics to every page.`,
  `Update the ${name} tracking code on every page to match my connected ${name} account.`,
];

const ANALYTICS_NOTES = (name) => [
  'Visits from the AppBlips preview, including the AI’s own testing, are not counted. Your exported pages count every visitor once they are online.',
  'The tracking code is written into every page and any HTML you export. That is how it is designed: anyone who sees it can only add visits to your stats, not read them.',
  `Projects built before you connected don’t change on their own. Copy a prompt from this page into the builder chat to add ${name} to one.`,
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
    // Ready-made requests the user copies into the builder chat (shown on the
    // settings page). They only work once the connector is connected.
    prompts: [
      'Make the contact form send its entries to my email using my connected Web3Forms account.',
      'Add a contact page with a form that emails me through my connected Web3Forms account.',
      'Add a newsletter signup form that sends each new signup to my email with Web3Forms.',
    ],
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
        'Projects built before you connected don’t change on their own. Copy a prompt from this page into the builder chat to add Web3Forms to one.',
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
    prompts: ANALYTICS_PROMPTS('Umami'),
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
    prompts: ANALYTICS_PROMPTS('Plausible'),
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
    prompts: [
      'Add my connected tawk.to chat bubble to every page.',
      'Add a “Chat with us” button that opens my tawk.to chat.',
      'Move anything in the bottom-right corner so it doesn’t cover the tawk.to chat bubble.',
    ],
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
        'Projects built before you connected don’t change on their own. Copy a prompt from this page into the builder chat to add tawk.to to one.',
        'tawk.to uses cookies to remember chats, so where the law requires it, your site may need a cookie notice.',
        'The Browser Game studio doesn’t use it.',
        'tawk.to is a separate service, free to use, with optional paid extras.',
      ],
    },
  },
  square: {
    id: 'square',
    name: 'Square',
    tagline: 'Take payments',
    description: 'Online payments. Buy, order and donate buttons in your websites and apps open your Square checkout, where people pay you by card, Apple Pay or Google Pay.',
    keyLabel: 'Payment links',
    keyPlaceholder: 'T-shirt https://square.link/u/AbC123xy\nMug https://square.link/u/DeF456zw',
    keyUrl: 'https://squareup.com/payment-links',
    multiline: true,
    isValidKey: (key) => !looksLikeSquareSecret(key) && squareLinks(key).length > 0,
    // Shown instead of `page.invalid` when the paste looks like a secret.
    looksSecret: looksLikeSquareSecret,
    page: {
      enableDescription: 'Buy and pay buttons in websites and apps the AI builds will open your Square checkout.',
      keyHelp: 'In the Square Dashboard, create a payment link, click Copy link and paste it here. To sell several things, put each one on its own line with its name before the link, like “T-shirt https://square.link/u/…”.',
      keyLinkLabel: 'Learn about Square Payment Links',
      invalid: 'That doesn’t look like a Square payment link. It starts with https://square.link/u/. Copy it from Payment links in the Square Dashboard.',
      secret: 'That looks like a secret Square access token. Never paste it here or anywhere public. AppBlips only needs your payment links, which start with https://square.link/u/. If you shared the token anywhere, replace it in the Square Developer Console.',
      connected: 'Connected. Buy and pay buttons in websites and apps you build or edit from now on will open your Square checkout.',
      needsKey: 'Add a payment link to finish setting up.',
    },
    prompts: [
      'Add a “Pay now” button to accept payments through my connected Square account.',
      'Add a “Buy now” button that takes people to my Square checkout.',
      'Add a shop section with a “Buy” button for each of my Square payment links.',
      'Add a “Donate” button that uses my Square payment link.',
    ],
    about: {
      what: 'Square takes payments for you. You create a payment link in Square for each thing you sell, and the buttons in your websites and apps open it. People pay on Square’s own checkout page by card, Apple Pay or Google Pay, and the money goes to your Square account.',
      steps: [
        'Sign up at squareup.com, or sign in to the Square Dashboard if you already use Square.',
        'Open Payment links in the Square Dashboard (type “payment links” in its search box if you can’t see it) and create a link: a payment, an item, a donation or an event. Square asks for the name and price there.',
        'Click Copy link.',
        'Turn on Square here and paste the link into the box. To sell several things, add one link per line, each with its name in front.',
        'From then on, when the AI builds or edits a Responsive Website or a Mobile & Web App, its buy, order, pay and donate buttons open your Square checkout.',
      ],
      notes: [
        'Payments are real, including from the preview. In the desktop app, the checkout opens in your normal web browser.',
        'Prices are set in Square. To change one, edit the payment link in Square; your website doesn’t need to change.',
        'Your payment links are written into your pages and any HTML you export. That is how they are designed: a link only lets people pay you.',
        'AppBlips never needs your Square access token or any other secret. Don’t paste one here.',
        'Projects built before you connected don’t change on their own. Copy a prompt from this page into the builder chat to add Square to one.',
        'The Browser Game studio doesn’t use it.',
        'Square is a separate service. It charges a fee on each payment.',
      ],
    },
  },
  pollinations: {
    id: 'pollinations',
    name: 'Pollinations',
    tagline: 'AI images and AI features',
    description: 'Open-source AI image and text generation. Ask the AI for generated images in your projects, or for AI features like a chatbot or an image generator.',
    signIn: true,
    keyUrl: 'https://enter.pollinations.ai',
    homeUrl: 'https://github.com/pollinations/pollinations',
    homeLinkLabel: 'Pollinations on GitHub (open source)',
    isValidKey: () => false,
    page: {
      enableDescription: 'When you ask for it, the AI makes images for websites and apps it builds, and adds AI features that run on Pollinations.',
      signInHelp: 'A Pollinations page opens in your web browser. Sign in there and approve AppBlips. On that page you choose the most Pollen (Pollinations’ credits) AppBlips may spend and for how many days.',
      connected: 'Connected. Ask for generated images or AI features in the builder chat.',
      needsSignIn: 'Sign in with Pollinations first, then turn this on.',
    },
    prompts: [
      'Replace the stock photos with images generated by my connected Pollinations account.',
      'Add a hero image made with Pollinations that fits this page.',
      'Add an AI chatbot that answers visitors’ questions, using Pollinations.',
      'Add an AI image generator where visitors type a description and get a picture, using Pollinations.',
    ],
    about: {
      what: 'Pollinations is an open-source service for AI images and text. With it connected, you can ask the AI for custom images in your websites and apps instead of stock photos, and for AI features such as a chatbot, a writing helper or an image generator.',
      steps: [
        'Click Sign in with Pollinations here.',
        'A Pollinations page opens in your web browser. Sign in there and approve AppBlips. On that page you choose the most Pollen it may spend and how many days the sign-in lasts.',
        'Back in AppBlips, the page shows your account name. Now turn on the Enable Pollinations switch.',
        'When you ask for generated images in a Responsive Website or a Mobile & Web App, AppBlips makes them with your account and puts their web addresses in your project. When you publish, AppBlips copies them to your Surge site so they stay online with it.',
        'For AI features in your sites, such as a chatbot, choose who pays under “AI features in your sites”. Safer: each visitor connects their own Pollinations account with a “Connect Pollinations” button and uses their own Pollen. Or: your own site key pays, so visitors need no account, but the key is in your sites’ code. The AI builds the features to match your choice.',
      ],
      notes: [
        'Each image is paid from your Pollen. Most image models cost a small fraction of one Pollen per image. The AI only uses Pollinations when you ask for generated images or AI features.',
        'Your sign-in stays inside AppBlips and is never written into your projects. It only pays for the images AppBlips makes for you.',
        'Pollinations deletes a stored image when nobody has viewed it for 30 days. Published and exported sites keep their own copy, but in a project you haven’t opened for a month an image can disappear. Ask the AI to make it again if that happens.',
        'A site key is different: if you choose it, it has to be in your sites so visitors’ browsers can use it. AppBlips scrambles it so it isn’t in plain sight, but this is not foolproof: anyone with a little know-how can find it and spend it. Only use a key made for this, with a small Pollen budget.',
        'The sign-in ends after the number of days you chose, or when it has spent its Pollen limit. Pollinations then turns off; sign in again here and turn it back on. You can cancel it, or a site key, at any time on the Keys page at enter.pollinations.ai.',
        'Projects built before you connected don’t change on their own. Copy a prompt from this page into the builder chat to use Pollinations in one.',
        'The Browser Game studio and imported codebases don’t use it.',
        'Pollinations is a separate service with its own terms and prices.',
        ...(POLLINATIONS_EARNINGS ? [POLLINATIONS_FEE_NOTE] : []),
      ],
    },
  },
};

export const CONNECTOR_IDS = Object.keys(CONNECTOR_DEFINITIONS);

// { [id]: { enabled: boolean, key: string, account?: string } } for every
// known connector (`account` only for sign-in connectors).
export const loadConnectors = () => {
  let stored = {};
  try {
    const parsed = JSON.parse(safeStorage('local')?.getItem(CONNECTORS_KEY) || '{}');
    if (parsed && typeof parsed === 'object') stored = parsed;
  } catch { /* unreadable: treat as nothing connected */ }
  return Object.fromEntries(CONNECTOR_IDS.map((id) => [id, {
    enabled: stored[id]?.enabled === true,
    key: typeof stored[id]?.key === 'string' ? stored[id].key : '',
    ...(CONNECTOR_DEFINITIONS[id].signIn ? {
      account: typeof stored[id]?.account === 'string' ? stored[id].account : '',
      aiPayer: stored[id]?.aiPayer === 'site' ? 'site' : 'visitors',
      siteKey: typeof stored[id]?.siteKey === 'string' ? stored[id].siteKey : '',
      // Set once Pollinations has confirmed the key has a budget and the user
      // has accepted that visitors can find it; cleared when the key changes.
      siteKeyAccepted: stored[id]?.siteKeyAccepted === true,
    } : {}),
  }]));
};

export const saveConnectors = (connectors) => {
  try {
    safeStorage('local')?.setItem(CONNECTORS_KEY, JSON.stringify(connectors));
  } catch { /* storage blocked: the setting just won't persist */ }
};

// 'connected' (on, valid key or signed in: used by the AI), 'needs-key' (on,
// key missing or malformed: not used yet), 'needs-sign-in' or 'off'.
export const connectorStatus = (id, connectors = loadConnectors()) => {
  const { enabled, key = '', account } = connectors[id] || {};
  if (!enabled) return 'off';
  if (CONNECTOR_DEFINITIONS[id].signIn) return account ? 'connected' : 'needs-sign-in';
  return CONNECTOR_DEFINITIONS[id].isValidKey(key.trim()) ? 'connected' : 'needs-key';
};

// The connectors the AI should build with: [{ id, key }]. Pollinations has no
// key to give the AI: its sign-in key stays on the server and its site key is
// added to pages at preview/export time (pollinationsHelper.js). Its `key` is
// how AI features are paid for, so the AI builds them to match: 'visitors',
// 'site', or 'none' (site key chosen but not added yet: no AI features).
export const getActiveConnectors = (connectors = loadConnectors()) => CONNECTOR_IDS
  .filter((id) => connectorStatus(id, connectors) === 'connected')
  .map((id) => ({ id, key: id === 'pollinations' ? pollinationsAiMode(connectors) : connectors[id].key.trim() }));

const pollinationsAiMode = (connectors) => {
  if (connectors.pollinations?.aiPayer !== 'site') return 'visitors';
  return getPollinationsSiteKey(connectors) ? 'site' : 'none';
};

// A user-authorized or dashboard secret key: sk_ and letters, digits, - or _.
export const SITE_KEY_RE = /^sk_[A-Za-z0-9_-]{8,200}$/;

// The key the user's sites spend on AI features, or ''. Only when chosen and
// accepted, and only while Pollinations is on: switching it off stops the
// key being written into anything new.
export const getPollinationsSiteKey = (connectors = loadConnectors()) => {
  const { enabled, aiPayer, siteKey = '', siteKeyAccepted } = connectors.pollinations || {};
  const key = siteKey.trim();
  return enabled && aiPayer === 'site' && siteKeyAccepted && SITE_KEY_RE.test(key) ? key : '';
};

// How the Pollinations helper in pages pays (pollinationsHelper.js). Visitor
// sign-in needs nothing of the user's, so it is the fallback whenever the
// site key isn't in use, except when the user chose the site key and hasn't
// added it: then AI features say they're unavailable.
export const getPollinationsHelperOptions = (connectors = loadConnectors()) => {
  const siteKey = getPollinationsSiteKey(connectors);
  const { enabled, aiPayer } = connectors.pollinations || {};
  return { siteKey, visitors: !siteKey && !(enabled && aiPayer === 'site') };
};

// Records the Pollinations account name after a sign-in, or clears it ('')
// after a sign-out or when the server reports the sign-in expired. Without an
// account the connector is switched off too, as in Settings.
export const savePollinationsAccount = (account) => {
  const connectors = loadConnectors();
  if (connectors.pollinations.account === account) return connectors;
  const next = { ...connectors, pollinations: { ...connectors.pollinations, account, ...(account ? {} : { enabled: false }) } };
  saveConnectors(next);
  return next;
};
