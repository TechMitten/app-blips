// Run: node testing/testCodeReview.js
import assert from 'node:assert/strict';
import { reviewGeneratedCode, MAX_CODE_REVIEW_TURNS, MAX_BROWSER_REVIEW_TURNS, BROWSER_WRAP_UP_TURNS, MAX_REVIEW_EDIT_ROUNDS } from '../src/lib/codeReview.js';

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

test = await run(Array.from({ length: MAX_CODE_REVIEW_TURNS }, () => verdict(false, ['Save is incomplete'])));
assert.equal(test.result.acceptable, false);
assert.match(test.result.warning, /ran out of turns\. Unresolved: Save is incomplete/);
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
// A late edit must not leave an untested revision: the wrap-up turns refuse
// edits so the current version can still be tested and accepted.
const wrapBrowser = { async open() { return { elements: [{ id: 'e1' }], errors: [] }; }, async execute() { return { observation: { errors: [] } }; } };
const wrapStart = MAX_BROWSER_REVIEW_TURNS - BROWSER_WRAP_UP_TURNS;
test = await run([
  ...Array.from({ length: wrapStart }, () => browserAction('inspect')),
  { tool_calls: [edit('<button>Save</button>', '<button>Late</button>')] },
  browserAction('click'), verdict(true),
], { browser: wrapBrowser });
assert.equal(test.result.acceptable, true, 'review finishes inside the wrap-up turns');
assert.equal(test.result.files, original, 'wrap-up edits are refused');
assert.ok(!test.requests[wrapStart].tools.some((tool) => tool.function.name === 'apply_surgical_edits'));
test = await run([verdict(false, ['Missing label']), verdict(true)]);
assert.ok(!test.requests[1].messages.at(-1).content.includes('browser'), 'no browser tests requested without a browser');
// A positive verdict with minor notes passes instead of looping on nitpicks.
test = await run([verdict(true, ['Could add a hover effect'])]);
assert.equal(test.result.acceptable, true);
assert.equal(test.requests.length, 1);
// Edit rounds are capped so the review converges instead of tinkering until
// the turn cap.
test = await run([
  ...Array.from({ length: MAX_REVIEW_EDIT_ROUNDS }, (_, i) => ({ tool_calls: [edit(i ? `Save ${i}` : 'Save', `Save ${i + 1}`)] })),
  { tool_calls: [edit(`Save ${MAX_REVIEW_EDIT_ROUNDS}`, 'Too many')] },
  verdict(true),
]);
assert.equal(test.result.acceptable, true);
assert.match(test.result.files['index.html'], new RegExp(`Save ${MAX_REVIEW_EDIT_ROUNDS}<`));
assert.ok(!test.requests[MAX_REVIEW_EDIT_ROUNDS].tools.some((tool) => tool.function.name === 'apply_surgical_edits'), 'edits close after the last round');
// The cap warning says why the review stopped.
test = await run(Array.from({ length: MAX_BROWSER_REVIEW_TURNS }, () => verdict(true)), { browser: wrapBrowser });
assert.match(test.result.warning, /not tested in the browser/);
test = await run(Array.from({ length: MAX_CODE_REVIEW_TURNS }, () => verdict(false)));
assert.match(test.result.warning, /did not approve/);
assert.match(test.requests[1].messages.at(-1).content, /without naming a problem/);
console.log('testCodeReview: ok');
