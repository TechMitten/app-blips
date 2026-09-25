// Run: node testing/testLoopProtection.js
//
// Regression tests for the loop-protection injected into previews, exports and
// deploys. The injected __orion_loop_check must halt a genuinely runaway
// synchronous loop, but must NOT fire on a loop that merely runs again every
// frame/tick (game and animation loops, timers) -- those yield between runs and
// are perfectly valid.
import assert from 'node:assert/strict';
import { injectLoopProtection } from '../src/lib/loopProtection.js';
import { injectPreviewBridge } from '../src/previewBridge.js';

const page = (body) => `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;

// 1. Loops are instrumented and the helper is injected.
const src = page('<script>function frame(){ for (var i=0;i<3;i++) {} }</script>');
const protectedHtml = injectLoopProtection(src);
assert.ok(protectedHtml.includes('window.__orion_loop_check(1);'), 'loop body is instrumented');
assert.ok(protectedHtml.includes('window.__orion_loop_check = function'), 'helper is injected');

// 2. Rebuild the shipped helper and drive it with a controllable clock/timers.
const helperMatch = protectedHtml.match(/<script>([\s\S]*?__orion_loop_check[\s\S]*?)<\/script>/);
assert.ok(helperMatch, 'injected helper script is extractable');
const helperSrc = helperMatch[1];

const makeHarness = () => {
  const timers = [];
  const win = {};
  new Function('window', 'setTimeout', helperSrc)(win, (fn) => { timers.push(fn); return timers.length; });
  return { win, timers };
};

const withFakeClock = (fn) => {
  const realNow = Date.now;
  const clock = { now: 0 };
  Date.now = () => clock.now;
  try {
    return fn(clock);
  } finally {
    Date.now = realNow;
  }
};

// 2a. A loop re-entered every frame (rAF / game / interval style) must not throw.
withFakeClock((clock) => {
  const { win, timers } = makeHarness();
  for (let frame = 0; frame < 300; frame++) {
    clock.now = frame * 16;
    win.__orion_loop_check(1);
    win.__orion_loop_check(1);
    while (timers.length) timers.shift()(); // the event loop yields between frames
  }
});

// 2b. A genuine synchronous infinite loop is still halted.
withFakeClock((clock) => {
  const { win } = makeHarness();
  let halted = false;
  try {
    for (let i = 0; i < 200000; i++) {
      clock.now = i * 0.02;
      win.__orion_loop_check(1);
    }
  } catch (err) {
    halted = /Infinite loop detected/.test(err.message);
  }
  assert.ok(halted, 'runaway synchronous loop is still halted');
});

// 3. The preview path applies loop protection too.
const preview = injectPreviewBridge(src, {});
assert.ok(preview.srcDoc.includes('window.__orion_loop_check'), 'preview gets loop protection');

console.log('testLoopProtection: ok');
