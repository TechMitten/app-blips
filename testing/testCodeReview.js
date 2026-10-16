// Run: node testing/testCodeReview.js
import assert from 'node:assert/strict';
import { reviewGeneratedCode, formatReviewReport, MAX_REVIEW_TURNS, LOOP_REPEAT_TURNS } from '../src/lib/codeReview.js';

const doc = (body) => `<!DOCTYPE html><html><head><title>Test</title></head><body>${body}</body></html>`;
const original = { 'index.html': doc('<button>Save</button>') };
const call = (name, args) => ({ id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } });
const problem = (title) => ({ title, evidence: `Saw: ${title}`, fix: `Fix ${title}` });
const report = (problems = [], summary = 'Checked it.') => ({ tool_calls: [call('submit_review_report', { summary, problems })] });
const edit = call('apply_surgical_edits', { file: null, edits: [{ search: '<button>Save</button>', replace: '<button>Changed</button>', occurrence: null, replace_all: null }] });
const run = async (responses, options = {}) => {
  const requests = [];
  const result = await reviewGeneratedCode({ files: original, prompt: 'Make a working save button',
    requestModelText: async (request) => {
      requests.push(structuredClone(request));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected model call');
      return response;
    }, ...options });
  return { result, requests };
};
const toolNames = (request) => request.tools.map((tool) => tool.function.name);

// A clean report passes; the review is told it cannot edit.
let test = await run([report()]);
assert.equal(test.result.acceptable, true);
assert.deepEqual(test.result.problems, []);
assert.match(test.requests[0].messages[0].content, /you cannot edit the code/);
assert.ok(!toolNames(test.requests[0]).includes('apply_surgical_edits'), 'edit tools are not offered');
assert.ok(toolNames(test.requests[0]).includes('view_code'), 'read tools are offered');

// Problems come back as the report; the files are never touched.
test = await run([report([problem('Save does nothing')])]);
assert.equal(test.result.acceptable, false);
assert.equal(test.result.problems[0].title, 'Save does nothing');
assert.equal(test.result.files, undefined);
assert.match(formatReviewReport(test.result), /^Checked it\.\n\n1\. Save does nothing: Saw: Save does nothing\n {3}Fix: Fix Save does nothing$/);

// An edit attempt is refused and the review carries on.
test = await run([{ tool_calls: [edit] }, report()]);
assert.match(test.requests[1].messages.findLast((m) => m.role === 'tool').content, /cannot edit/);

// A malformed report is asked for again.
test = await run([{ tool_calls: [call('submit_review_report', { summary: 'x', problems: ['not an object'] })] }, report()]);
assert.equal(test.requests.length, 2);

// Problems the app detects itself are added to the report.
const broken = { 'index.html': doc('<script>const = ;</script>') };
test = await run([report()], { files: broken });
assert.equal(test.result.acceptable, false);
assert.equal(test.result.problems[0].title, 'Code error');
test = await run([report()], { files: { 'index.html': doc('<a href="missing.html">x</a>') }, studioMode: 'website' });
assert.equal(test.result.problems[0].title, 'Broken page link');

// Transport failures and cancellation.
test = await run([new Error('Provider unavailable')]);
assert.equal(test.result.acceptable, false);
assert.match(test.result.warning, /could not finish/);
await assert.rejects(run([new DOMException('Aborted', 'AbortError')]), { name: 'AbortError' });
await assert.rejects(run([], { signal: AbortSignal.abort() }), { name: 'AbortError' });

// Browser review: asked once to screenshot before reporting; runtime errors
// seen while testing end up in the report.
const shotBrowser = {
  async open() { return { elements: [{ id: 'e1' }], errors: ['Boom'] }; },
  async execute(args) { return { ...(args.action === 'screenshot' ? { dataUrl: `data:image/png;base64,${args.target}` } : {}), observation: { errors: [] } }; },
};
const shoot = (target) => ({ tool_calls: [call('browser_action', { action: 'screenshot', target })] });
const images = (request) => request.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url) : []);
test = await run([report(), shoot('a'), shoot('b'), report()], { browser: shotBrowser });
assert.match(test.requests[1].messages.findLast((m) => m.role === 'tool').content, /Take screenshots/);
assert.equal(test.result.screenshotsTaken, 2);
assert.deepEqual(images(test.requests[2]), ['data:image/png;base64,a']);
assert.deepEqual(images(test.requests[3]), ['data:image/png;base64,b'], 'only the newest screenshot is resent');
assert.equal(test.result.problems[0].title, 'Runtime error');
assert.match(test.requests[0].messages[0].content, /Take screenshots/);

// A model that rejects images continues without them.
test = await run([shoot('a'), new Error('This model does not support image input'), report()], { browser: shotBrowser });
assert.deepEqual(images(test.requests[2]), []);
assert.ok(!test.requests[2].tools.find((t) => t.function.name === 'browser_action').function.parameters.properties.action.enum.includes('screenshot'));
assert.equal(test.result.warning, undefined);

test = await run([], { browser: { async open() { throw new Error('Frame unavailable'); } } });
assert.match(test.result.warning, /Browser testing could not finish/);

// Repeating the same calls forces the report.
const inspect = { tool_calls: [call('browser_action', { action: 'inspect', target: null })] };
test = await run([...Array.from({ length: LOOP_REPEAT_TURNS + 1 }, () => inspect), report([problem('Overlap')])], { browser: shotBrowser });
assert.deepEqual(toolNames(test.requests.at(-1)), ['submit_review_report']);
assert.equal(test.result.problems[0].title, 'Overlap');

// New calls every turn run until the backstop, whose last turn only takes a report.
test = await run(Array.from({ length: MAX_REVIEW_TURNS }, (_, i) => ({ tool_calls: [call('view_code', { file: `page${i}.html` })] })));
assert.equal(test.requests.length, MAX_REVIEW_TURNS);
assert.deepEqual(toolNames(test.requests.at(-1)), ['submit_review_report']);
assert.match(test.result.warning, /ran out of turns/);
console.log('testCodeReview: ok');
