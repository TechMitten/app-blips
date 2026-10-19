// Run: node testing/testCodeReview.js
import assert from 'node:assert/strict';
import { reviewGeneratedCode, formatReviewReport, MAX_REVIEW_TURNS, LOOP_REPEAT_TURNS } from '../src/lib/codeReview.js';
import { BROWSER_ACTION_TOOL } from '../src/lib/browserTools.js';

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

// Linked connectors reach the reviewer, so it doesn't flag a Web3Forms form as
// breaking the "forms have no backend" rule.
test = await run([report()], { studioMode: 'website', connectors: [{ id: 'web3forms', key: '11111111-2222-3333-4444-555555555555' }] });
assert.match(test.requests[0].messages[0].content, /Web3Forms \(form backend\)/);
test = await run([report()], { studioMode: 'website' });
assert.doesNotMatch(test.requests[0].messages[0].content, /Web3Forms/);

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
assert.equal(test.result.screenshotsOff, false);

// A batch taken in one turn is shown together, each labelled with its page
// and screen size; next turn they become lines naming what they showed.
const labelledBrowser = {
  async open() { return { elements: [], errors: [] }; },
  async execute(args) {
    return { dataUrl: `data:image/png;base64,${args.target}`, page: 'index.html', screen: args.target,
      observation: { errors: [], viewport: { width: args.target === 'mobile' ? 390 : 1280, height: 800, scrollX: 0, scrollY: 0 } } };
  },
};
test = await run([{ tool_calls: [
  call('browser_action', { action: 'screenshot', target: 'mobile' }),
  { ...call('browser_action', { action: 'screenshot', target: 'desktop' }), id: 'call-2' },
] }, shoot('tablet'), report()], { browser: labelledBrowser });
assert.deepEqual(images(test.requests[1]), ['data:image/png;base64,mobile', 'data:image/png;base64,desktop'], 'a batch is shown whole');
const labels = (request) => request.messages.flatMap((m) => Array.isArray(m.content) ? [m.content[0].text] : []);
assert.match(labels(test.requests[1])[0], /#1 \(index\.html, mobile screen, 390×800 px viewport, scrolled to y=0\)/);
assert.match(labels(test.requests[1])[1], /#2 \(index\.html, desktop screen, 1280×800/);
assert.deepEqual(images(test.requests[2]), ['data:image/png;base64,tablet']);
assert.ok(test.requests[2].messages.some((m) => typeof m.content === 'string' && /^\[Screenshot of the embedded browser #2 \(index\.html, desktop screen.*\) was removed/.test(m.content)));
assert.ok(BROWSER_ACTION_TOOL.function.parameters.required.includes('notes'), 'the reviewer records what it saw');

// One screenshot of a long page comes back as one image per screen, each
// labelled with where it was taken; the result says how many there were.
const pageBrowser = {
  async open() { return { elements: [], errors: [] }; },
  async execute() {
    return { shots: [{ dataUrl: 'data:image/png;base64,top', scrollY: 0 }, { dataUrl: 'data:image/png;base64,end', scrollY: 760 }],
      page: 'index.html', screen: 'desktop', observation: { errors: [], viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 1560 } } };
  },
};
test = await run([shoot(null), report()], { browser: pageBrowser });
assert.equal(test.result.screenshotsTaken, 2);
assert.deepEqual(images(test.requests[1]), ['data:image/png;base64,top', 'data:image/png;base64,end'], 'every screen is shown');
assert.match(labels(test.requests[1])[1], /#2 \(index\.html, desktop screen, 1280×800 px viewport, scrolled to y=760 of 1560 px page height\)/);
assert.match(test.requests[1].messages.findLast((m) => m.role === 'tool').content, /"screenshots":2/);

// Before the first turn the review captures the page at every screen size
// itself; repeated content and cut-off pages are named in the labels.
const firstLookBrowser = {
  async open() { return { elements: [], errors: [] }; },
  async capturePage() {
    return { page: 'index.html', screen: 'desktop', observation: { errors: [], viewport: { width: 1280, height: 800, scrollY: 0 } }, shots: [
      { dataUrl: 'data:image/png;base64,m1', screen: 'mobile', width: 390, height: 800, scrollY: 0, pageHeight: 1000 },
      { dataUrl: 'data:image/png;base64,m2', screen: 'mobile', width: 390, height: 800, scrollY: 200, pageHeight: 1000, repeatsPx: 600 },
      { dataUrl: 'data:image/png;base64,d1', screen: 'desktop', width: 1280, height: 800, scrollY: 0, pageHeight: 99999, pageContinues: true },
    ] };
  },
  async execute() { return { observation: { errors: [] } }; },
};
test = await run([report()], { browser: firstLookBrowser });
assert.deepEqual(images(test.requests[0]), ['data:image/png;base64,m1', 'data:image/png;base64,m2', 'data:image/png;base64,d1']);
assert.match(labels(test.requests[0])[0], /#1 \(index\.html, mobile screen, 390×800 px viewport, scrolled to y=0 of 1000 px page height\)/);
assert.match(labels(test.requests[0])[1], /top 600 px of scrolled content repeat the previous image/);
assert.match(labels(test.requests[0])[2], /desktop screen.*The page continues below this image/);
assert.ok(test.requests[0].messages.some((m) => typeof m.content === 'string' && /The 3 screenshots below show this whole page at every screen size/.test(m.content)));
assert.equal(test.result.screenshotsTaken, 3);
assert.equal(test.requests.length, 1, 'no nagging for screenshots after the first look');

// Every problem needs photo evidence: a report citing no screenshot (or one
// never taken) is sent back; a cited one comes back as a photo with where it
// was taken. After two chances, problems still without one are left out.
const cite = (title, screenshot) => ({ ...problem(title), screenshot });
const citedReport = (...problems) => ({ tool_calls: [call('submit_review_report', { summary: 'Checked.', problems })] });
test = await run([shoot('a'), citedReport(cite('Overlap', null), cite('Cut off', 1)), citedReport(cite('Overlap', 7), cite('Cut off', 1)), shoot('b'), citedReport(cite('Overlap', 2), cite('Cut off', 1))], { browser: labelledBrowser });
assert.match(test.requests[2].messages.findLast((m) => m.role === 'tool').content, /photo evidence.*taken so far: #1\).*Overlap/);
assert.doesNotMatch(test.requests[2].messages.findLast((m) => m.role === 'tool').content, /Cut off/);
assert.match(test.requests[3].messages.findLast((m) => m.role === 'tool').content, /Overlap/, 'a screenshot that was never taken does not count');
assert.deepEqual(test.result.problems.map((item) => [item.title, item.screenshot]), [['Overlap', 2], ['Cut off', 1]]);
assert.deepEqual(test.result.photos, { 1: 'data:image/png;base64,a', 2: 'data:image/png;base64,b' });
assert.equal(test.result.problems[1].seenIn, 'index.html, a screen, 1280×800 px viewport, scrolled to y=0');
assert.match(formatReviewReport(test.result), /2\. Cut off: Saw: Cut off\n {3}Seen in screenshot 1: index\.html, a screen/);
assert.equal(test.result.unshownDropped, undefined);

test = await run([shoot('a'), citedReport(cite('Overlap', null), cite('Cut off', 1)), citedReport(cite('Overlap', null), cite('Cut off', 1)), citedReport(cite('Overlap', null), cite('Cut off', 1))], { browser: labelledBrowser });
assert.equal(test.requests.length, 4);
assert.deepEqual(test.result.problems.map((item) => item.title), ['Cut off'], 'a claim never shown is left out');
assert.equal(test.result.unshownDropped, 1);
assert.deepEqual(Object.keys(test.result.photos), ['1'], 'only cited screenshots are returned');

// Without screenshots (code-only review) problems need no photo.
test = await run([citedReport(cite('Overlap', null))]);
assert.deepEqual(test.result.problems.map((item) => item.title), ['Overlap']);
assert.deepEqual(test.result.photos, {});

// A model that rejects images continues without them.
test = await run([shoot('a'), new Error('This model does not support image input'), report()], { browser: shotBrowser });
assert.deepEqual(images(test.requests[2]), []);
assert.ok(!test.requests[2].tools.find((t) => t.function.name === 'browser_action').function.parameters.properties.action.enum.includes('screenshot'));
assert.equal(test.result.warning, undefined);
assert.equal(test.result.screenshotsOff, true);

test = await run([], { browser: { async open() { throw new Error('Frame unavailable'); } } });
assert.match(test.result.warning, /Browser testing could not finish/);

// Repeating the same calls forces the report.
const inspect = { tool_calls: [call('browser_action', { action: 'inspect', target: null })] };
test = await run([...Array.from({ length: LOOP_REPEAT_TURNS + 1 }, () => inspect), report([problem('Overlap')])], { browser: shotBrowser });
assert.deepEqual(toolNames(test.requests.at(-1)), ['submit_review_report']);
assert.equal(test.result.problems[0].title, 'Overlap');

// Scrolling by the same amount down a long page is progress, not a repeat.
let scrolled = 0;
const scrollBrowser = {
  async open() { return { elements: [], errors: [], viewport: { scrollY: 0 } }; },
  async execute(args) {
    if (args.action === 'scroll') scrolled += args.y;
    return { page: 'index.html', screen: 'desktop', observation: { errors: [], viewport: { width: 1280, height: 800, scrollY: scrolled } } };
  },
};
const scrollDown = { tool_calls: [call('browser_action', { action: 'scroll', target: null, y: 700 })] };
test = await run([...Array.from({ length: LOOP_REPEAT_TURNS + 2 }, () => scrollDown), report()], { browser: scrollBrowser });
assert.ok(test.requests.at(-1).tools.length > 1, 'scrolling to new positions keeps testing open');
assert.equal(scrolled, 700 * (LOOP_REPEAT_TURNS + 2));

// New calls every turn run until the backstop, whose last turn only takes a report.
test = await run(Array.from({ length: MAX_REVIEW_TURNS }, (_, i) => ({ tool_calls: [call('view_code', { file: `page${i}.html` })] })));
assert.equal(test.requests.length, MAX_REVIEW_TURNS);
assert.deepEqual(toolNames(test.requests.at(-1)), ['submit_review_report']);
assert.match(test.result.warning, /ran out of turns/);
console.log('testCodeReview: ok');
