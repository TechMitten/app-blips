// Run: node testing/testConnectors.js
// Connectors (lib/connectors.js) and the prompt text they add (prompts.js).
import assert from 'node:assert/strict';

// A tiny localStorage, installed before the module reads it.
const data = new Map();
globalThis.window = { localStorage: {
  get length() { return data.size; },
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => { data.set(k, String(v)); },
} };

const {
  squareLinks, loadConnectors, saveConnectors, connectorStatus, getActiveConnectors, CONNECTORS_KEY, CONNECTOR_DEFINITIONS, CONNECTOR_IDS,
  savePollinationsAccount,
} = await import('../src/lib/connectors.js');
const { buildHtmlSystemPrompt, buildConnectorDirective, buildAskConnectorNote, WEBSITE_HTML_SYSTEM_PROMPT } = await import('../src/lib/prompts.js');

const KEY = '3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c';
const NOTHING = { web3forms: { enabled: false, key: '' }, umami: { enabled: false, key: '' }, plausible: { enabled: false, key: '' }, tawkto: { enabled: false, key: '' }, square: { enabled: false, key: '' }, pollinations: { enabled: false, key: '', account: '', aiPayer: 'visitors', siteKey: '', siteKeyAccepted: false } };

// Nothing saved: everything off, nothing active.
assert.deepEqual(loadConnectors(), NOTHING);
assert.equal(connectorStatus('web3forms'), 'off');
assert.deepEqual(getActiveConnectors(), []);

// On without a usable key is not active, so the AI isn't told to use a bad key.
saveConnectors({ web3forms: { enabled: true, key: '' } });
assert.equal(connectorStatus('web3forms'), 'needs-key');
saveConnectors({ web3forms: { enabled: true, key: 'not-a-key' } });
assert.equal(connectorStatus('web3forms'), 'needs-key');
assert.deepEqual(getActiveConnectors(), []);

// A valid key (surrounding spaces from a paste are ignored) is active.
saveConnectors({ web3forms: { enabled: true, key: `  ${KEY} ` } });
assert.equal(connectorStatus('web3forms'), 'connected');
assert.deepEqual(getActiveConnectors(), [{ id: 'web3forms', key: KEY }]);

// Switched off keeps the key but stops using it.
saveConnectors({ web3forms: { enabled: false, key: KEY } });
assert.equal(connectorStatus('web3forms'), 'off');
assert.deepEqual(getActiveConnectors(), []);
assert.equal(loadConnectors().web3forms.key, KEY);

// Corrupt or hostile storage never throws and reads as nothing connected.
for (const raw of ['{', 'null', '[]', '"x"', '{"web3forms":{"enabled":"yes","key":5}}']) {
  data.set(CONNECTORS_KEY, raw);
  assert.deepEqual(loadConnectors(), NOTHING, raw);
}

// Prompt: the directive carries the key, replaces the "no backend" rule, and
// is left out for games and when nothing is connected.
const active = [{ id: 'web3forms', key: KEY }];
const website = buildHtmlSystemPrompt('website', active);
assert.ok(website.startsWith(WEBSITE_HTML_SYSTEM_PROMPT));
assert.match(website, /CONNECTORS/);
assert.match(website, new RegExp(`name="access_key" value="${KEY}"`));
assert.match(website, /api\.web3forms\.com\/submit/);
assert.match(buildHtmlSystemPrompt('app', active), /access_key/);
assert.equal(buildHtmlSystemPrompt('game', active), buildHtmlSystemPrompt('game'));  // games have no forms
assert.equal(buildHtmlSystemPrompt('website', []), buildHtmlSystemPrompt('website'));
assert.equal(buildConnectorDirective([{ id: 'unknown', key: 'x' }]), '');

// Analytics: the pasted tracking code is rebuilt from the values it needs.
const { embedSnippet } = await import('../src/lib/connectors.js');
const SITE = '9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';
const UMAMI_CLOUD = `<script defer src="https://cloud.umami.is/script.js" data-website-id="${SITE}"></script>`;
assert.equal(embedSnippet('umami', SITE), UMAMI_CLOUD);  // bare website ID: Umami Cloud
assert.equal(embedSnippet('umami', SITE.toUpperCase()), UMAMI_CLOUD);
assert.equal(embedSnippet('umami', UMAMI_CLOUD), UMAMI_CLOUD);
assert.equal(
  embedSnippet('umami', `<script data-website-id='${SITE}' defer src="https://stats.example.com/u.js" data-host-url="https://api.example.com/" data-domains="example.com,www.example.com" onload="alert(1)"></script>`),
  `<script defer src="https://stats.example.com/u.js" data-website-id="${SITE}" data-host-url="https://api.example.com" data-domains="example.com,www.example.com"></script>`,
);
for (const bad of ['', 'abc', `<script src="http://x.com/s.js" data-website-id="${SITE}"></script>`,
  `<script src="javascript:alert(1)" data-website-id="${SITE}"></script>`, '<script src="https://cloud.umami.is/script.js" data-website-id="nope"></script>']) {
  assert.equal(embedSnippet('umami', bad), null, bad);
}

const PA = 'https://plausible.io/js/pa-AbC_12-xyz.js';
const newSnippet = embedSnippet('plausible', `<!-- Privacy-friendly analytics by Plausible -->\n<script async src="${PA}"></script>\n<script>\n  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};\n  plausible.init({ fetch: () => alert(1) })\n</script>`);
assert.ok(newSnippet.startsWith(`<script async src="${PA}"></script>\n<script>window.plausible=`), newSnippet);
assert.ok(newSnippet.endsWith('plausible.init()</script>') && !newSnippet.includes('alert'));
assert.equal(embedSnippet('plausible', PA), newSnippet);  // just the script URL
assert.equal(
  embedSnippet('plausible', '<script defer data-domain="example.com" src="https://plausible.io/js/script.outbound-links.js"></script>'),
  '<script defer data-domain="example.com" src="https://plausible.io/js/script.outbound-links.js"></script>',
);
for (const bad of ['', SITE, 'https://plausible.io/js/script.js', '<script defer src="https://plausible.io/js/script.js"></script>',
  '<script defer data-domain="a.com&quot;><img" src="https://plausible.io/js/script.js"></script>', `<script async src="${PA.replace('https', 'http')}"></script>`]) {
  assert.equal(embedSnippet('plausible', bad), null, bad);
}
// Quotes and angle brackets can't escape the rebuilt attribute.
assert.ok(embedSnippet('plausible', 'https://plausible.io/js/pa-x.js?a="><b>').startsWith('<script async src="https://plausible.io/js/pa-x.js?a=%22%3E%3Cb%3E"></script>'));

saveConnectors({ ...NOTHING, umami: { enabled: true, key: ` ${UMAMI_CLOUD}\n` }, plausible: { enabled: true, key: 'not code' } });
assert.equal(connectorStatus('umami'), 'connected');
assert.equal(connectorStatus('plausible'), 'needs-key');
const analytics = getActiveConnectors();
assert.deepEqual(analytics, [{ id: 'umami', key: UMAMI_CLOUD }]);
// Unlike Web3Forms, analytics also goes into games.
for (const mode of ['website', 'app', 'game']) {
  const prompt = buildHtmlSystemPrompt(mode, analytics);
  assert.ok(prompt.includes(`EVERY HTML page, once, character for character:\n${UMAMI_CLOUD}\n`), mode);
}
assert.ok(buildHtmlSystemPrompt('game', [...analytics, ...active]).includes('Umami'));
assert.ok(!buildHtmlSystemPrompt('game', [...analytics, ...active]).includes('access_key'));

// tawk.to: the widget code as its dashboard shows it; only the two IDs are kept.
const TAWK = `<!--Start of Tawk.to Script-->
<script type="text/javascript">
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/64f1a2b3c4d5e6f708192a3b/1habc2def';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();
</script>
<!--End of Tawk.to Script-->`;
const tawk = embedSnippet('tawkto', TAWK);
assert.ok(tawk.includes("s1.src='https://embed.tawk.to/64f1a2b3c4d5e6f708192a3b/1habc2def';"), tawk);
assert.ok(tawk.startsWith('<!--Start of Tawk.to Script-->\n<script>') && tawk.endsWith('<!--End of Tawk.to Script-->'));
assert.equal(embedSnippet('tawkto', TAWK.replace('</script>', 'alert(1)</script>')), tawk);  // extra code is dropped
assert.equal(embedSnippet('tawkto', 'https://embed.tawk.to/64f1a2b3c4d5e6f708192a3b/default'), tawk.replace('1habc2def', 'default'));
assert.ok(!embedSnippet('tawkto', "https://embed.tawk.to/64f1a2b3c4d5e6f708192a3b/x';alert(1);//").includes('alert'));
for (const bad of ['', SITE, 'https://embed.tawk.to/64f1a2b3c4d5e6f708192a3b',
  'http://embed.tawk.to/64f1a2b3c4d5e6f708192a3b/default', 'https://embed.tawk.to.evil.com/64f1a2b3c4d5e6f708192a3b/default']) {
  assert.equal(embedSnippet('tawkto', bad), null, bad);
}
const chat = [{ id: 'tawkto', key: TAWK }];
assert.ok(buildHtmlSystemPrompt('website', chat).includes(`just before </body> of EVERY HTML page, once, character for character:\n${tawk}\n`));
assert.match(buildHtmlSystemPrompt('app', chat), /embed\.tawk\.to/);
assert.equal(buildHtmlSystemPrompt('game', chat), buildHtmlSystemPrompt('game'));  // a chat bubble would cover play

// Square: payment links, one per line with an optional name, also found in
// Square's button code. Secrets are refused even next to a valid link.
{
  const square = CONNECTOR_DEFINITIONS.square;
  const LINK = 'https://square.link/u/AbC123xy';
  assert.deepEqual(squareLinks(LINK), [{ name: '', url: LINK }]);
  assert.deepEqual(
    squareLinks(`T-shirt - ${LINK}\nMug: https://square.link/u/DeF456zw?src=embed\n${LINK}`),
    [{ name: 'T-shirt', url: LINK }, { name: 'Mug', url: 'https://square.link/u/DeF456zw' }],
  );
  assert.deepEqual(squareLinks(`<a target="_blank" href="${LINK}?src=embed">Buy now</a>`), [{ name: '', url: LINK }]);
  assert.deepEqual(squareLinks(`https://example.com ${LINK}`), [{ name: '', url: LINK }]);
  const longForm = 'https://checkout.square.site/merchant/ML123ABC/checkout/XYZ789AB';
  assert.deepEqual(squareLinks(longForm), [{ name: '', url: longForm }]);
  for (const bad of ['http://square.link/u/AbC123xy', `${LINK}-x`, 'https://square.link.evil.com/u/AbC123xy', 'https://evil.com/?square.link/u/AbC123xy', 'buy my shirt']) {
    assert.equal(square.isValidKey(bad), false, bad);
  }
  assert.ok(square.isValidKey(LINK));
  for (const secret of ['EAAAl1234567890abcdefghijklmnopqrstu', 'sq0csp-abc123', 'sq0atp-abc123']) {
    assert.equal(square.isValidKey(`${secret}\n${LINK}`), false, secret);
    assert.ok(square.looksSecret(secret), secret);
  }
  assert.equal(square.looksSecret(LINK), false);
  assert.equal(squareLinks(Array.from({ length: 25 }, (_, i) => `https://square.link/u/Link${String(i).padStart(4, '0')}`).join('\n')).length, 20);

  const directive = buildConnectorDirective([{ id: 'square', key: `T-shirt ${LINK}` }], 'website');
  assert.match(directive, /T-shirt: https:\/\/square\.link\/u\/AbC123xy/);
  assert.match(directive, /target="_blank"/);
  assert.equal(buildConnectorDirective([{ id: 'square', key: LINK }], 'game'), '');
}

// Pollinations: losing the sign-in (sign-out, expiry) also switches it off.
{
  saveConnectors({ pollinations: { enabled: true, account: 'octo' } });
  assert.equal(connectorStatus('pollinations'), 'connected');
  savePollinationsAccount('');
  assert.equal(loadConnectors().pollinations.enabled, false);
  assert.equal(connectorStatus('pollinations'), 'off');
  savePollinationsAccount('octo');
  assert.equal(connectorStatus('pollinations'), 'off', 'signing in again doesn’t switch it on by itself');
  saveConnectors({});
}

// Games get Pollinations too, with an exception to their "no external images"
// rule, or the model keeps drawing the picture in code.
{
  const pollinations = [{ id: 'pollinations', key: 'visitors' }];
  assert.match(buildHtmlSystemPrompt('game', pollinations), /gen\.pollinations\.ai\/image/);
  assert.match(buildConnectorDirective(pollinations, 'game'), /one exception to the "no external image assets" rule/);
  assert.doesNotMatch(buildConnectorDirective(pollinations, 'website'), /no external image assets/);
}

// Questions are answered without the build prompt, so they get a note saying
// which connectors are on, or the model claims it can't use Pollinations.
{
  assert.equal(buildAskConnectorNote([], 'app'), '');
  assert.equal(buildAskConnectorNote([{ id: 'square', key: 'x' }], 'game'), '');
  const ask = buildAskConnectorNote([{ id: 'pollinations', key: 'visitors' }], 'website');
  assert.match(ask, /Pollinations/);
  assert.match(ask, /Never say Pollinations can't be used/);
  assert.match(ask, /switch to Build mode/);
  assert.match(buildAskConnectorNote([{ id: 'pollinations', key: 'visitors' }], 'app', true), /offer to do it/);
  assert.doesNotMatch(buildAskConnectorNote([{ id: 'umami', key: KEY }], 'app'), /Pollinations/);
}

// Every connector carries the text its "How it works" dialog shows, its
// settings page wording and at least one prompt to copy into the chat.
for (const id of CONNECTOR_IDS) {
  const { about, page, prompts } = CONNECTOR_DEFINITIONS[id];
  assert.ok(Array.isArray(prompts) && prompts.length > 0, `${id}: prompts`);
  for (const prompt of prompts) assert.ok(typeof prompt === 'string' && prompt.trim(), `${id}: prompt text`);
  assert.equal(new Set(prompts).size, prompts.length, `${id}: prompts are unique (they are React keys)`);
  // Sign-in connectors (Pollinations) have no key box, so no key wording.
  const fields = CONNECTOR_DEFINITIONS[id].signIn
    ? ['enableDescription', 'signInHelp', 'connected', 'needsSignIn']
    : ['enableDescription', 'keyHelp', 'keyLinkLabel', 'invalid', 'connected', 'needsKey'];
  for (const field of fields) {
    assert.ok(typeof page?.[field] === 'string' && page[field], `${id}: page.${field}`);
  }
  assert.ok(typeof about?.what === 'string' && about.what, `${id}: about.what`);
  assert.ok(Array.isArray(about.steps) && about.steps.length > 0, `${id}: about.steps`);
  assert.ok(!about.notes || Array.isArray(about.notes), `${id}: about.notes`);
}

console.log('ok');
