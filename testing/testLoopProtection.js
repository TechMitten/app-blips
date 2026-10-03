// Run: node testing/testLoopProtection.js
//
// Regression tests for the loop-protection injected into previews, exports and
// deploys. The injected __orion_loop_check must halt a genuinely runaway
// synchronous loop, but must NOT fire on a loop that merely runs again every
// frame/tick (game and animation loops, timers) -- those yield between runs and
// are perfectly valid.
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
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

// 4. Nested braceless loops stay valid. Instrumenting them one at a time used
// to shift the code under the outer loop's stale offsets, putting its closing
// brace mid-statement ("Unexpected token '}'" on code the model wrote fine).
const nestedApp = [
  '<script>',
  'const g = [];',
  'for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {',
  '  g.push(r + c);',
  '}',
  'for (let i = 0; i < 2; i++) for (const x of g) if (x) g.length;',
  'let n = 0; while (n < 3) n++;',
  'do n--; while (n > 0);',
  'for (const k in { a: 1 }) for (;;) break;',
  '</script>',
].join('\n');
const nestedSrc = page(nestedApp);
const nestedOut = injectLoopProtection(nestedSrc);
const scriptBodies = [...nestedOut.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.equal(scriptBodies.length, 2, 'helper + app script');
for (const body of scriptBodies) acorn.parse(body, { ecmaVersion: 'latest' });
assert.equal((nestedOut.match(/__orion_loop_check\(\d+\)/g) || []).length, 8, 'every loop is instrumented');

// 5. No lines are added, so runtime error line numbers keep matching the
// app's source (the preview subtracts only the bridge's own lines).
assert.equal(nestedOut.split('\n').length, nestedSrc.split('\n').length, 'loop protection adds no lines');

console.log('testLoopProtection: ok');
