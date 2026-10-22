// Run: node testing/testProfile.js
// The name and chat avatar from the first onboarding slide (lib/profile.js).
import assert from 'node:assert/strict';

// A tiny localStorage, installed before the module reads it.
const data = new Map();
globalThis.window = { localStorage: {
  get length() { return data.size; },
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => { data.set(k, String(v)); },
} };

const { loadProfile, saveProfile, cleanName, PROFILE_KEY, AVATAR_IDS, MAX_NAME_LENGTH } = await import('../src/lib/profile.js');

// Nothing saved: no name, no avatar (the chat keeps the plain person icon).
assert.deepEqual(loadProfile(), { name: '', avatar: '' });

// Saved and read back, with the name tidied.
assert.deepEqual(saveProfile({ name: '  Sam   Lee ', avatar: 'cat' }), { name: 'Sam Lee', avatar: 'cat' });
assert.deepEqual(loadProfile(), { name: 'Sam Lee', avatar: 'cat' });

// Long names are cut; unknown avatars are dropped.
assert.equal(cleanName('x'.repeat(100)).length, MAX_NAME_LENGTH);
saveProfile({ name: 'Ana', avatar: '<img>' });
assert.deepEqual(loadProfile(), { name: 'Ana', avatar: '' });

// Damaged or hand-edited data falls back instead of throwing.
data.set(PROFILE_KEY, '{not json');
assert.deepEqual(loadProfile(), { name: '', avatar: '' });
data.set(PROFILE_KEY, JSON.stringify({ name: 42, avatar: 'rocket' }));
assert.deepEqual(loadProfile(), { name: '42', avatar: 'rocket' });

assert.ok(AVATAR_IDS.length >= 8);
console.log('testProfile: ok');
