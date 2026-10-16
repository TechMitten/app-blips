// Run: node testing/testCodeReviewPipeline.js
// Vite resolves the renderer's extensionless imports. Scripted API responses
// exercise the public generation entry point without spending provider tokens.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const savedFetch = globalThis.fetch;
try {
  const { generateAppCode, reviewBuild } = await server.ssrLoadModule('/src/lib/llm.js');
  const html = '<!DOCTYPE html><html><head><title>Test</title></head><body><button>Save</button></body></html>';
  const call = (name, args) => ({ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  let responses = [];
  let requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const response = responses.shift();
    assert.ok(response, 'unexpected API request');
    return Response.json({ choices: [{ message: response }] });
  };
  const generate = (code = null, ask = false, autoFix = false) => generateAppCode(
    'Make Save work', code, [], null, 'both', null, ask, false, null, autoFix,
    { build: 'none' }, 'app', code ? { 'index.html': code } : null, '', false,
  );

  // Builds and edits no longer review on their own: the review is opt-in and
  // runs through reviewBuild when the user accepts the offer.
  responses = [{ content: html }, { content: 'Built a save button.' }];
  let result = await generate();
  assert.equal(result.editMode, 'full-generation');
  assert.equal(result.qualityReview, undefined);
  assert.ok(!requests.some((req) => req.tools?.some((tool) => tool.function.name === 'submit_review_report')), 'a build does not start a review');
  assert.equal(responses.length, 0);

  requests = [];
  responses = [{ content: 'The save button needs a handler.' }];
  result = await generate(html, true);
  assert.equal(result.editMode, 'ask');
  assert.equal(requests.length, 1, 'questions do not start a code review');

  // The review only reports. Problems become a mission for a fresh chat.
  const reportCall = (problems) => ({ tool_calls: [call('submit_review_report', { summary: 'Checked.', problems })] });
  requests = [];
  responses = [reportCall([{ title: 'Save does nothing', evidence: 'Clicked Save, nothing was stored.', fix: 'Add a click handler.' }])];
  result = await reviewBuild({ files: { 'index.html': html }, previousFiles: { 'index.html': html }, prompt: 'Make Save work' });
  assert.equal(result.qualityReview.acceptable, false);
  assert.equal(result.files, undefined, 'a review never edits');
  assert.match(result.mission, /^Fix the problems a review found in this app\./);
  assert.match(result.mission, /1\. Save does nothing: Clicked Save/);
  assert.match(result.reply, /found one problem\. I'm starting a new chat/);
  assert.ok(requests[0].messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('Project before this edit')));
  assert.equal(responses.length, 0, 'a review makes no extra summary call');

  let opens = 0;
  const browser = {
    async open(files) { opens++; assert.equal(files['index.html'], html); return { elements: [{ id: 'e1' }], errors: [] }; },
    async execute(args) { return { ...(args.action === 'screenshot' ? { dataUrl: 'data:image/png;base64,x' } : {}), observation: { errors: [] } }; },
  };
  responses = [{ tool_calls: [call('browser_action', { action: 'screenshot', target: null })] }, reportCall([])];
  result = await reviewBuild({ files: { 'index.html': html }, prompt: 'Make Save work', browser });
  assert.equal(opens, 1, 'the review opens the build in the embedded browser');
  assert.equal(result.qualityReview.acceptable, true);
  assert.equal(result.mission, null);
  assert.match(result.reply, /reviewed and tested the app and found no problems/);
  assert.equal(responses.length, 0);

  console.log('testCodeReviewPipeline: ok');
} finally {
  globalThis.fetch = savedFetch;
  await server.close();
}
