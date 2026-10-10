// Run: node testing/testCodeReview.js
import assert from 'node:assert/strict';
import { reviewGeneratedCode, MAX_REVIEW_TURNS, LOOP_STALLED_VERDICTS, LOOP_REPEAT_TURNS, LOOP_ROLLBACKS, CODE_WRAP_UP_TURNS, BROWSER_WRAP_UP_TURNS } from '../src/lib/codeReview.js';

const doc = (body) => `<!DOCTYPE html><html><head><title>Test</title></head><body>${body}</body></html>`;
const original = { 'index.html': doc('<button>Save</button>') };
const call = (name, args) => ({ id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } });
const verdict = (acceptable, findings = []) => ({ tool_calls: [call('submit_code_review', { acceptable, findings })] });
const edit = (search, replace, file = null) => call('apply_surgical_edits', { file, edits: [{ search, replace, occurrence: null, replace_all: null }] });
const run = async (responses, options = {}) => {
  const requests = [];
  const statuses = [];
  const result = await reviewGeneratedCode({ files: original, prompt: 'Make a working save button',
    onChunk: (text, kind) => statuses.push([text, kind]),
    requestModelText: async (request) => {
      requests.push(structuredClone(request));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected model call');
      return response;
    }, ...options });
  return { result, requests, statuses };
};

let test = await run([verdict(true)]);
assert.equal(test.result.acceptable, true);
assert.equal(test.result.improved, false);
assert.equal(test.result.files, original);
assert.match(test.requests[0].messages[0].content, /Check more than syntax/);

test = await run([
  verdict(false, ['Save button has no handler']),
  { tool_calls: [edit('<button>Save</button>', '<button onclick="localStorage.setItem(\'saved\', \'yes\')">Save</button>')] },
  verdict(true),
]);
assert.equal(test.result.acceptable, true);
assert.equal(test.result.improved, true);
assert.match(test.result.files['index.html'], /localStorage.setItem/);
assert.equal(original['index.html'], doc('<button>Save</button>'), 'input must not be mutated');
assert.ok(test.requests[2].messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('Updated project to review')));

test = await run([
  { tool_calls: [edit('<button>Save</button>', '<script>const = ;</script>'), call('submit_code_review', { acceptable: true, findings: [] })] },
  verdict(true),
]);
assert.equal(test.requests.length, 2, 'an edit and verdict cannot pass together');
assert.equal(test.result.files, original, 'invalid improvement is rolled back');
assert.ok(test.requests[1].messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('rolled back')));

const site = { ...original, 'about.html': doc('<button>Contact</button>') };
test = await run([
  { tool_calls: [edit('<button>Contact</button>', '<a href="index.html">Home</a>', 'about.html')] },
  verdict(true),
], { files: site, previousFiles: site, studioMode: 'website' });
assert.match(test.result.files['about.html'], /href="index.html"/);
assert.equal(test.result.files['index.html'], original['index.html']);
assert.match(test.requests[0].messages.at(-1).content, /Project before this edit/);

test = await run([
  { tool_calls: [edit('<button>Save</button>', '<a href="missing.html">Missing</a>')] }, verdict(true),
], { studioMode: 'website' });
assert.equal(test.result.files, original, 'broken page link is rolled back');

// Rejecting the same version again and again without editing is a loop.
test = await run(Array.from({ length: LOOP_STALLED_VERDICTS + CODE_WRAP_UP_TURNS }, () => verdict(false, ['Save is incomplete'])));
assert.equal(test.result.acceptable, false);
assert.match(test.result.warning, /stopped because the reviewer kept rejecting the code without fixing it: Save is incomplete/);
assert.equal(test.requests.at(-1).tools.length, 1, 'last call only allows a verdict');

test = await run([{ tool_calls: [call('submit_code_review', { acceptable: 'yes', findings: [] })] }, verdict(true)]);
assert.equal(test.requests.length, 2, 'malformed verdict must be retried');
test = await run([new Error('Provider unavailable')]);
assert.equal(test.result.acceptable, false);
assert.match(test.result.warning, /could not finish/);
assert.equal(test.result.files, original, 'transport failure preserves the build');

await assert.rejects(run([new DOMException('Aborted', 'AbortError')]), { name: 'AbortError' });
await assert.rejects(run([], { signal: AbortSignal.abort() }), { name: 'AbortError' });

const browserCalls = [];
const browserAction = (action) => ({ tool_calls: [call('browser_action', { action, target: 'e1' })] });
const browser = {
  async open(files) {
    browserCalls.push(files);
    return { elements: [{ id: 'e1' }], errors: browserCalls.length === 1 ? ['Runtime failure'] : [] };
  },
  async execute() { return { observation: { errors: browserCalls.length === 1 ? ['Runtime failure'] : [] } }; },
};
test = await run([
  verdict(true), browserAction('inspect'), verdict(true),
  { tool_calls: [edit('<button>Save</button>', '<button>Save safely</button>')] },
  verdict(true), browserAction('click'), verdict(true),
], { browser });
assert.equal(test.requests.length, 7, 'browser checks and runtime errors block premature acceptance');
assert.equal(browserCalls.length, 2, 'improved code must be reopened and retested');
assert.equal(test.result.acceptable, true);
assert.equal(test.result.browserTests.length, 2);
test = await run([], { browser: { async open() { throw new Error('Frame unavailable'); } } });
assert.equal(test.result.acceptable, false);
assert.match(test.result.warning, /Browser testing could not finish/);
// Once a loop is found, the wrap-up turns refuse edits so the current version
// can still be tested and accepted.
const wrapBrowser = { async open() { return { elements: [{ id: 'e1' }], errors: [] }; }, async execute() { return { observation: { errors: [] } }; } };
test = await run([
  ...Array.from({ length: LOOP_REPEAT_TURNS + 1 }, () => browserAction('inspect')),
  { tool_calls: [edit('<button>Save</button>', '<button>Late</button>')] },
  browserAction('click'), verdict(true),
], { browser: wrapBrowser });
assert.equal(test.result.acceptable, true, 'review finishes inside the wrap-up turns');
assert.equal(test.result.files, original, 'wrap-up edits are refused');
assert.ok(test.requests[LOOP_REPEAT_TURNS].tools.some((tool) => tool.function.name === 'apply_surgical_edits'), 'edits stay open before the loop');
assert.ok(!test.requests[LOOP_REPEAT_TURNS + 1].tools.some((tool) => tool.function.name === 'apply_surgical_edits'));
test = await run([verdict(false, ['Missing label']), verdict(true)]);
assert.ok(!test.requests[1].messages.at(-1).content.includes('browser'), 'no browser tests requested without a browser');
// A positive verdict with minor notes passes instead of looping on nitpicks.
test = await run([verdict(true, ['Could add a hover effect'])]);
assert.equal(test.result.acceptable, true);
assert.equal(test.requests.length, 1);
// A review that keeps fixing different problems is not cut off.
const issues = ['Missing label', 'Contrast too low', 'No focus ring', 'Layout overflows on phones', 'Empty state missing', 'Keyboard shortcut broken', 'Error message unclear'];
const step = (i) => edit(i ? `Save ${i}` : 'Save', `Save ${i + 1}`);
test = await run([...issues.flatMap((issue, i) => [verdict(false, [issue]), { tool_calls: [step(i)] }]), verdict(true)]);
assert.equal(test.result.acceptable, true, 'many productive edit rounds still pass');
assert.match(test.result.files['index.html'], new RegExp(`Save ${issues.length}<`));
// A long browser review with progress runs past the old 32-turn cap.
const clickOn = (target) => ({ tool_calls: [call('browser_action', { action: 'click', target })] });
test = await run([...Array.from({ length: 17 }, (_, i) => [clickOn(`e${i}`), { tool_calls: [step(i)] }]).flat(), clickOn('e99'), verdict(true)], { browser: wrapBrowser });
assert.equal(test.result.acceptable, true);
assert.ok(test.requests.length > 32);
// The same finding surviving several fixes is a loop, even when reworded.
test = await run([
  verdict(false, ['Save is incomplete']), { tool_calls: [step(0)] },
  verdict(false, ['The save button is still incomplete']), { tool_calls: [step(1)] },
  verdict(false, ['Save incomplete']), { tool_calls: [step(2)] },
  verdict(false, ['Save is incomplete']),
  verdict(false, ['Save is incomplete']), verdict(false, ['Save is incomplete']),
]);
assert.equal(test.result.acceptable, false);
assert.match(test.result.warning, /kept trying to fix the same problem without success: Save is incomplete/);
assert.ok(!test.requests[7].tools.some((tool) => tool.function.name === 'apply_surgical_edits'), 'edits close once looping');
assert.equal(test.requests.length, 7 + CODE_WRAP_UP_TURNS);
// Edits that keep breaking the code are a loop.
test = await run([
  ...Array.from({ length: LOOP_ROLLBACKS }, () => ({ tool_calls: [edit('<button>Save</button>', '<script>const = ;</script>')] })),
  verdict(false, ['Broken']), verdict(false, ['Broken']),
]);
assert.match(test.result.warning, /edits kept breaking the code/);
assert.equal(test.result.files, original);
// Accepting without ever testing is reported as such.
test = await run(Array.from({ length: LOOP_STALLED_VERDICTS + BROWSER_WRAP_UP_TURNS }, () => verdict(true)), { browser: wrapBrowser });
assert.match(test.result.warning, /never tested in the browser/);
// Rejecting twice without naming a problem means nothing is left to fix.
test = await run([verdict(false), verdict(false)]);
assert.equal(test.result.acceptable, true);
assert.match(test.requests[1].messages.at(-1).content, /without naming a problem/);
// New calls every turn never trip the loop checks; the backstop ends it.
test = await run(Array.from({ length: MAX_REVIEW_TURNS }, (_, i) => ({ tool_calls: [call('read_page', { file: `page${i}.html` })] })));
assert.equal(test.requests.length, MAX_REVIEW_TURNS);
assert.match(test.result.warning, new RegExp(`safety limit of ${MAX_REVIEW_TURNS} turns\\. The reviewer never gave a verdict`));
// Only the newest screenshot is resent; older ones become a short note.
const shotBrowser = { ...wrapBrowser, async execute(args) { return { dataUrl: `data:image/png;base64,${args.target}`, observation: { errors: [] } }; } };
const shoot = (target) => ({ tool_calls: [call('browser_action', { action: 'screenshot', target })] });
const images = (request) => request.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url) : []);
test = await run([shoot('a'), shoot('b'), clickOn('e1'), verdict(true)], { browser: shotBrowser });
assert.equal(test.result.acceptable, true);
assert.deepEqual(images(test.requests[1]), ['data:image/png;base64,a']);
assert.deepEqual(images(test.requests[2]), ['data:image/png;base64,b']);
assert.ok(test.requests[2].messages.some((m) => typeof m.content === 'string' && m.content.includes('earlier screenshot was removed')));
// A model that rejects images gets the request again without them, and
// screenshots stay off for the rest of the review.
test = await run([shoot('a'), new Error('This model does not support image input'), shoot('b'), clickOn('e1'), verdict(true)], { browser: shotBrowser });
assert.equal(test.result.acceptable, true);
assert.deepEqual(images(test.requests[2]), []);
assert.ok(!test.requests[2].tools.find((t) => t.function.name === 'browser_action').function.parameters.properties.action.enum.includes('screenshot'));
assert.match(test.requests[3].messages.findLast((m) => m.role === 'tool').content, /Screenshots are off/);
assert.deepEqual(images(test.requests[3]), []);
// Without screenshots in the conversation, a model error still ends the review.
test = await run([new Error('Provider unavailable')], { browser: shotBrowser });
assert.equal(test.result.acceptable, false);
console.log('testCodeReview: ok');
