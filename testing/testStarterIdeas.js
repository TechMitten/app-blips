// Run: node testing/testStarterIdeas.js
import assert from 'node:assert/strict';
import {
  STARTER_PRESETS, WEBSITE_STARTER_PRESETS, GAME_STARTER_PRESETS, ASK_STARTER_PRESETS, STARTER_SAMPLE_SIZE,
} from '../src/lib/constants.js';

const pools = {
  app: STARTER_PRESETS,
  website: WEBSITE_STARTER_PRESETS,
  game: GAME_STARTER_PRESETS,
  ask: ASK_STARTER_PRESETS,
};

for (const [name, pool] of Object.entries(pools)) {
  // Titles are React keys within a gallery, so a repeat would collide.
  const titles = pool.map((idea) => idea.title);
  assert.equal(new Set(titles).size, titles.length, `${name}: duplicate starter titles`);
  for (const idea of pool) {
    const where = `${name}: ${idea.title}`;
    assert.ok(idea.title && idea.prompt && idea.category, `${where} is missing title/prompt/category`);
    assert.ok(idea.icon, `${where} has no icon (not imported in constants.js?)`);
  }
}

// Each sliding studio needs enough ideas to fill several pages.
for (const studio of ['app', 'website', 'game']) {
  assert.ok(pools[studio].length >= STARTER_SAMPLE_SIZE[studio] * 5, `${studio}: too few starter ideas`);
}

console.log('testStarterIdeas: ok');
