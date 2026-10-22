// Run: node testing/testConnectorRequest.js
// "Request a connector" (lib/connectorRequest.js), with a fake fetch so
// nothing is really sent.
import assert from 'node:assert/strict';

const {
  sendConnectorRequest: send, validateConnectorRequest, MAX_DETAILS_LENGTH, MIN_FILL_MS, COOLDOWN_MS,
} = await import('../src/lib/connectorRequest.js');

// A clock the test moves by hand. Each send defaults to a form opened long
// enough ago, and the clock jumps past the cooldown between sends, so the
// bot checks only kick in where a test sets them up.
let clock = 1_000_000;
const now = () => clock;
const sendConnectorRequest = (fields, options) => {
  clock += COOLDOWN_MS;
  return send({ openedAt: clock - MIN_FILL_MS, ...fields }, { now, ...options });
};

const calls = [];
const replying = (status, json) => async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return { ok: status < 400, json: async () => json };
};

// Validation: a service is required; email is optional but must look right.
assert.match(validateConnectorRequest({ service: '  ' }), /service/);
assert.match(validateConnectorRequest({ service: 'Stripe', email: 'nope' }), /email/);
assert.equal(validateConnectorRequest({ service: 'Stripe', email: '' }), '');
assert.equal(validateConnectorRequest({ service: 'Stripe', email: ' me@example.com ' }), '');

// Invalid input never reaches the network.
let result = await sendConnectorRequest({ service: '' }, { fetchImpl: replying(200, { success: true }) });
assert.equal(result.ok, false);
assert.equal(calls.length, 0);

// A good request posts to Web3Forms with the AppBlips key, trimmed fields,
// and the email only when one was given.
result = await sendConnectorRequest(
  { service: '  Calendly ', details: ` ${'x'.repeat(MAX_DETAILS_LENGTH + 50)} `, email: '' },
  { fetchImpl: replying(200, { success: true }) },
);
assert.deepEqual(result, { ok: true, message: 'Thanks! Your request was sent.' });
assert.equal(calls[0].url, 'https://api.web3forms.com/submit');
assert.equal(calls[0].init.method, 'POST');
const { body } = calls[0];
assert.equal(body.access_key, 'c0b38db4-3383-420f-aaff-4da44dad333b');
assert.equal(body.subject, 'Connector request: Calendly');
assert.equal(body.service, 'Calendly');
assert.equal(body.details.length, MAX_DETAILS_LENGTH);
assert.ok(!('email' in body));
assert.equal(typeof body.app_version, 'string');
assert.equal(body.botcheck, false);

await sendConnectorRequest({ service: 'Stripe', email: ' me@example.com ' }, { fetchImpl: replying(200, { success: true }) });
assert.equal(calls[1].body.email, 'me@example.com');
assert.equal(calls[1].body.details, '(none)');

// Failures: Web3Forms' own message, a reply without one, and no connection.
result = await sendConnectorRequest({ service: 'Stripe' }, { fetchImpl: replying(400, { success: false, message: 'Invalid access key' }) });
assert.deepEqual(result, { ok: false, message: 'It wasn’t sent: Invalid access key' });
result = await sendConnectorRequest({ service: 'Stripe' }, { fetchImpl: async () => ({ ok: false, json: async () => { throw new Error('not json'); } }) });
assert.equal(result.ok, false);
assert.match(result.message, /try again/);
result = await sendConnectorRequest({ service: 'Stripe' }, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
assert.match(result.message, /internet connection/);
// Closing the dialog mid-send: no message to show.
result = await sendConnectorRequest({ service: 'Stripe' }, { fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
assert.deepEqual(result, { ok: false, message: '' });

// Bot protection. A ticked honeypot or a send under MIN_FILL_MS looks like
// success but sends nothing.
let before = calls.length;
result = await sendConnectorRequest({ service: 'Stripe', botcheck: true }, { fetchImpl: replying(200, { success: true }) });
assert.deepEqual(result, { ok: true, message: 'Thanks! Your request was sent.' });
result = await sendConnectorRequest({ service: 'Stripe', openedAt: clock + COOLDOWN_MS - MIN_FILL_MS + 1 }, { fetchImpl: replying(200, { success: true }) });
assert.equal(result.ok, true);
assert.equal(calls.length, before);

// A second real send within COOLDOWN_MS of the last one is refused; after it, fine.
clock += COOLDOWN_MS;
result = await send({ service: 'Stripe', openedAt: 0 }, { fetchImpl: replying(200, { success: true }), now });
assert.equal(result.ok, true);
before = calls.length;
clock += COOLDOWN_MS - 1;
result = await send({ service: 'Stripe', openedAt: 0 }, { fetchImpl: replying(200, { success: true }), now });
assert.equal(result.ok, false);
assert.match(result.message, /wait a minute/);
assert.equal(calls.length, before);
clock += 1;
result = await send({ service: 'Stripe', openedAt: 0 }, { fetchImpl: replying(200, { success: true }), now });
assert.equal(result.ok, true);
assert.equal(calls.length, before + 1);

console.log('ok');
