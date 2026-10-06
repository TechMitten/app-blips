// Run: node testing/testGameEngineRouter.js
// The routing decision itself is an LLM call (routeGameEngine in llm.js); this
// checks the parts around it: reading the reply and building the prompt.
import assert from 'node:assert/strict';
import { parseGameEngineChoice, buildGameEngineDirective, buildGameInitialGenerationPrompt } from '../src/lib/prompts.js';

const replies = {
  phaser: 'phaser', 'Phaser': 'phaser', 'three': 'three', ' canvas.\n': 'canvas',
  '**three**': 'three', 'user': null, 'User': null, '': null, 'pixi': null, undefined: null,
};
for (const [reply, want] of Object.entries(replies)) {
  assert.equal(parseGameEngineChoice(reply === 'undefined' ? undefined : reply), want, `parse ${JSON.stringify(reply)}`);
}

assert.equal(buildGameEngineDirective(null), '');
for (const engine of ['phaser', 'three', 'canvas']) assert.match(buildGameEngineDirective(engine), /^ENGINE /);

const withLine = buildGameInitialGenerationPrompt('snake', '', buildGameEngineDirective('canvas'));
assert.match(withLine, /request: snake\.\n\nENGINE \(chosen for this genre\): no game engine/);
assert.doesNotMatch(buildGameInitialGenerationPrompt('snake', ''), /ENGINE \(/);

console.log('ok');
