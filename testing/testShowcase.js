// Run: node testing/testShowcase.js
// The Showcase list and "Submit to the showcase" (lib/showcase.js), with a
// fake fetch so nothing is really sent.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const {
  SHOWCASE_PROJECTS, SHOWCASE_SITE_URL, normalizeProjectUrl, validateShowcaseSubmission,
  sendShowcaseSubmission: send, MAX_DESCRIPTION_LENGTH,
} = await import('../src/lib/showcase.js');
const { MIN_FILL_MS, COOLDOWN_MS, APPBLIPS_FORMS_KEY } = await import('../src/lib/appblipsInbox.js');

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

// Every listed example is bundled, has a web address, and names a known kind.
assert.ok(SHOWCASE_PROJECTS.length >= 7);
for (const project of SHOWCASE_PROJECTS) {
  assert.ok(project.name && project.description && project.category, project.name);
  assert.ok(['app', 'website', 'game'].includes(project.kind), project.name);
  assert.match(project.url, /^https:\/\//);
  if (project.file) {
    assert.ok(existsSync(`${publicDir}/showcase/${project.file}`), `missing public/showcase/${project.file}`);
    assert.equal(project.url, `${SHOWCASE_SITE_URL}/${project.file}`);
  }
  if (project.thumbnail) assert.ok(existsSync(`${publicDir}${project.thumbnail}`), `missing ${project.thumbnail}`);
}
assert.equal(new Set(SHOWCASE_PROJECTS.map((p) => p.url)).size, SHOWCASE_PROJECTS.length, 'duplicate showcase url');

// Addresses: public http(s) pages only; a missing scheme means https.
assert.equal(normalizeProjectUrl('  my-site.surge.sh '), 'https://my-site.surge.sh/');
assert.equal(normalizeProjectUrl('https://example.com/game?x=1'), 'https://example.com/game?x=1');
assert.equal(normalizeProjectUrl('http://example.com'), 'http://example.com/');
for (const bad of ['', 'localhost:3000', 'http://localhost', 'https://192.168.1.4', 'file:///C:/site.html',
  'javascript:alert(1)', 'https://user:pw@example.com', 'ftp://example.com', 'https://printer.local', 'not a url',
  `https://example.com/${'x'.repeat(600)}`]) {
  assert.equal(normalizeProjectUrl(bad), '', bad);
}

const good = {
  name: ' Ada ', email: ' ada@example.com ', projectName: ' Pixel Pets ', projectUrl: 'pixel-pets.surge.sh',
  kind: 'game', description: '', consent: true,
};
assert.equal(validateShowcaseSubmission(good), '');
assert.match(validateShowcaseSubmission({ ...good, name: ' ' }), /name/);
assert.match(validateShowcaseSubmission({ ...good, email: '' }), /email/);
assert.match(validateShowcaseSubmission({ ...good, email: 'nope' }), /email/);
assert.match(validateShowcaseSubmission({ ...good, projectName: '' }), /project’s name/);
assert.match(validateShowcaseSubmission({ ...good, projectUrl: '' }), /address/);
assert.match(validateShowcaseSubmission({ ...good, projectUrl: 'http://localhost:5175' }), /doesn’t look right/);
assert.match(validateShowcaseSubmission({ ...good, kind: 'tool' }), /app, website or game/);
assert.match(validateShowcaseSubmission({ ...good, consent: false }), /Tick/);

// A clock the test moves by hand, as in testConnectorRequest.js.
let clock = 1_000_000;
const now = () => clock;
const sendShowcaseSubmission = (fields, options) => {
  clock += COOLDOWN_MS;
  return send({ openedAt: clock - MIN_FILL_MS, ...fields }, { now, ...options });
};
const calls = [];
const replying = (status, json) => async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return { ok: status < 400, json: async () => json };
};

// Invalid input never reaches the network.
let result = await sendShowcaseSubmission({ ...good, consent: false }, { fetchImpl: replying(200, { success: true }) });
assert.equal(result.ok, false);
assert.equal(calls.length, 0);

// A good submission posts trimmed, normalized fields to the AppBlips inbox,
// with the sender's email as the reply-to.
result = await sendShowcaseSubmission(
  { ...good, description: ` ${'x'.repeat(MAX_DESCRIPTION_LENGTH + 20)} ` },
  { fetchImpl: replying(200, { success: true }) },
);
assert.deepEqual(result, { ok: true, message: 'Thanks! Your project was submitted.' });
assert.equal(calls[0].url, 'https://api.web3forms.com/submit');
assert.equal(calls[0].init.method, 'POST');
const { body } = calls[0];
assert.equal(body.access_key, APPBLIPS_FORMS_KEY);
assert.equal(body.subject, 'Showcase submission: Pixel Pets');
assert.equal(body.name, 'Ada');
assert.equal(body.email, 'ada@example.com');
assert.equal(body.project_name, 'Pixel Pets');
assert.equal(body.project_url, 'https://pixel-pets.surge.sh/');
assert.equal(body.project_type, 'Game');
assert.equal(body.description.length, MAX_DESCRIPTION_LENGTH);
assert.equal(body.permission_to_feature, 'Yes');
assert.equal(typeof body.app_version, 'string');
assert.equal(body.botcheck, false);

await sendShowcaseSubmission(good, { fetchImpl: replying(200, { success: true }) });
assert.equal(calls[1].body.description, '(none)');

// Failures come back as messages, never throws.
result = await sendShowcaseSubmission(good, { fetchImpl: replying(400, { success: false, message: 'Invalid access key' }) });
assert.deepEqual(result, { ok: false, message: 'It wasn’t sent: Invalid access key' });
result = await sendShowcaseSubmission(good, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
assert.match(result.message, /internet connection/);

// Bot protection: honeypot or a too-fast send looks sent but isn't.
let before = calls.length;
result = await sendShowcaseSubmission({ ...good, botcheck: true }, { fetchImpl: replying(200, { success: true }) });
assert.equal(result.ok, true);
result = await sendShowcaseSubmission({ ...good, openedAt: clock + COOLDOWN_MS - 1 }, { fetchImpl: replying(200, { success: true }) });
assert.equal(result.ok, true);
assert.equal(calls.length, before);

// Cooldown between real sends.
clock += COOLDOWN_MS;
result = await send({ ...good, openedAt: 0 }, { fetchImpl: replying(200, { success: true }), now });
assert.equal(result.ok, true);
before = calls.length;
clock += COOLDOWN_MS - 1;
result = await send({ ...good, openedAt: 0 }, { fetchImpl: replying(200, { success: true }), now });
assert.match(result.message, /wait a minute/);
assert.equal(calls.length, before);

console.log('ok');
