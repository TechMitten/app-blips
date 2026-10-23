// Run: node testing/testTourSteps.js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildTourSteps } from '../src/lib/tourSteps.js';

// Every anchor a step names must exist somewhere in the UI, or the step loses
// its spotlight (it falls back to the next anchor, and the last one is final).
const anchors = new Set();
for (const dir of ['src', 'src/components']) {
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.jsx'))) {
    for (const [, id] of readFileSync(`${dir}/${name}`, 'utf8').matchAll(/data-tour="([a-z-]+)"/g)) anchors.add(id);
  }
}

const text = (step) => [step.title, step.body, ...(step.tips || [])].join(' ');

for (const studioMode of ['app', 'website', 'game', 'codebase']) {
  for (const wideScreen of [true, false]) {
    for (const hasCode of [true, false]) {
      const steps = buildTourSteps({ wideScreen, hasCode, showCodeView: true, studioMode });
      const label = `${studioMode} wide=${wideScreen} code=${hasCode}`;
      assert.equal(new Set(steps.map((step) => step.id)).size, steps.length, `${label}: unique ids`);
      for (const step of steps) {
        for (const target of step.target) assert.ok(anchors.has(target), `${label}: ${step.id} targets missing anchor "${target}"`);
        // AI mode was removed from the composer; the tour must not offer it.
        assert.doesNotMatch(text(step), /\bAI builds\b|Build, Ask, or AI/, `${label}: ${step.id} mentions AI mode`);
      }
      const share = steps.find((step) => step.id === 'share');
      if (studioMode === 'codebase') {
        // Imported sites have no Publish or Open key, and export a project zip.
        assert.ok(!share.target.includes('publish'));
        assert.match(text(share), /\.zip/);
        assert.doesNotMatch(text(share), /Publish|Open in a new tab/);
        assert.match(text(steps.find((step) => step.id === 'preview')), /Files tab/);
      } else {
        assert.equal(share.target[0], 'publish');
        assert.match(text(share), /Publish/);
      }
      assert.equal(steps.some((step) => step.id === 'edit'), studioMode === 'website' && hasCode, `${label}: edit step`);
      assert.match(text(steps.at(-1)), /Connectors/, `${label}: finish mentions Connectors`);
    }
  }
}

console.log('tour steps ok');
