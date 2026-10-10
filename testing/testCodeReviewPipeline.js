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
  const edit = { tool_calls: [call('apply_surgical_edits', { edits: [{ search: '<button>Save</button>', replace: '<button onclick="localStorage.setItem(\'saved\', \'yes\')">Save</button>', occurrence: null, replace_all: null }] })] };
  const accepted = { tool_calls: [call('submit_code_review', { acceptable: true, findings: [] })] };
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
  assert.ok(!requests.some((req) => req.tools?.some((tool) => tool.function.name === 'submit_code_review')), 'a build does not start a review');
  assert.equal(responses.length, 0);

  requests = [];
  responses = [{ content: 'The save button needs a handler.' }];
  result = await generate(html, true);
  assert.equal(result.editMode, 'ask');
  assert.equal(requests.length, 1, 'questions do not start a code review');

  requests = [];
  responses = [edit, accepted];
  result = await reviewBuild({ files: { 'index.html': html }, previousFiles: { 'index.html': html }, prompt: 'Make Save work' });
  assert.equal(result.qualityReview.acceptable, true);
  assert.match(result.files['index.html'], /localStorage.setItem/);
  assert.match(result.reply, /fixed the problems/);
  assert.ok(requests[0].messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('Project before this edit')));
  assert.equal(responses.length, 0, 'a review makes no extra summary call');

  let opens = 0;
  let interactions = 0;
  const browser = {
    async open(files) { opens++; assert.equal(files['index.html'], html); return { elements: [{ id: 'e1' }], errors: [] }; },
    async execute(args) { interactions++; assert.equal(args.action, 'click'); return { observation: { errors: [] } }; },
  };
  responses = [accepted, { tool_calls: [call('browser_action', { action: 'click', target: 'e1' })] }, accepted];
  result = await reviewBuild({ files: { 'index.html': html }, prompt: 'Make Save work', browser });
  assert.equal(opens, 1, 'the review opens the build in the embedded browser');
  assert.equal(interactions, 1);
  assert.equal(result.qualityReview.acceptable, true);
  assert.equal(result.qualityReview.browserTests[0].action, 'click');
  assert.match(result.reply, /reviewed and tested the app and found no problems/);
  assert.equal(responses.length, 0);

  responses = Array.from({ length: 10 }, () => ({ tool_calls: [call('submit_code_review', { acceptable: false, findings: ['Save is incomplete'] })] }));
  result = await reviewBuild({ files: { 'index.html': html }, prompt: 'Make Save work' });
  assert.match(result.reply, /Review note: Code review stopped because the reviewer kept rejecting the code without fixing it: Save is incomplete/);
  console.log('testCodeReviewPipeline: ok');
} finally {
  globalThis.fetch = savedFetch;
  await server.close();
}
