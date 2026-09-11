import assert from 'node:assert/strict';
import { AI_BRIDGE_SOURCE, injectAiBridge } from '../src/lib/aiBridge.js';

const providerSecret = 'must-never-enter-html';
const token = 'public-deployment-token';
const fixture = '<!doctype html><html><head><title>Fixture</title></head><body>ok</body></html>';
const output = injectAiBridge(fixture, token);

assert.equal(AI_BRIDGE_SOURCE.includes('</'), false);
assert.equal(output.includes('data-appblips-ai="true"'), true);
assert.equal(output.includes(token), true);
assert.equal(output.includes(providerSecret), false);
assert.equal(output.includes('window.blip'), true);
assert.equal(output.includes('window.BLIP'), true);
assert.equal(output.includes('window.ai'), true);
assert.equal(output.indexOf('data-appblips-ai'), output.lastIndexOf('data-appblips-ai'));

console.log('AI bridge injection checks passed.');
