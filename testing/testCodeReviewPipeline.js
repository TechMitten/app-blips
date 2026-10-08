// Run: node testing/testCodeReviewPipeline.js
// Vite resolves the renderer's extensionless imports. Scripted API responses
// exercise the public generation entry point without spending provider tokens.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const savedFetch = globalThis.fetch;
try {
  const { generateAppCode } = await server.ssrLoadModule('/src/lib/llm.js');
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
  const generate = (code = null, ask = false, autoFix = false, browser = null) => generateAppCode(
    'Make Save work', code, [], null, 'both', null, ask, false, null, autoFix,
    { build: 'none' }, 'app', code ? { 'index.html': code } : null, '', false, browser,
  );

  responses = [{ content: html }, edit, accepted, { content: 'Built a working save button.' }];
  let result = await generate();
  assert.equal(result.editMode, 'full-generation');
  assert.equal(result.qualityReview.acceptable, true);
  assert.match(result.code, /localStorage.setItem/);
  assert.equal(result.files['index.html'], result.code, 'reviewed code is what gets saved');
  assert.equal(responses.length, 0);
  assert.ok(requests[1].tools.some((tool) => tool.function.name === 'submit_code_review'));

  requests = [];
  responses = [edit, { content: 'Updated.' }, accepted, { content: 'Updated the save button.' }];
  result = await generate(html);
  assert.equal(result.editMode, 'surgical');
  assert.equal(result.qualityReview.acceptable, true);
  assert.ok(requests[2].messages.some((msg) => typeof msg.content === 'string' && msg.content.includes('Project before this edit')));
  assert.equal(responses.length, 0);

  requests = [];
  responses = [{ content: 'The save button needs a handler.' }];
  result = await generate(html, true);
  assert.equal(result.editMode, 'ask');
  assert.equal(result.qualityReview, undefined);
  assert.equal(requests.length, 1, 'questions do not start a code review');

  responses = [edit, { content: 'Fixed.' }, accepted];
  result = await generate(html, false, true);
  assert.equal(result.qualityReview.acceptable, true, 'auto-fixes are also reviewed');
  assert.equal(responses.length, 0, 'auto-fixes do not request a completion summary');
  let opens = 0;
  let interactions = 0;
  const browser = {
    async open(files) { opens++; assert.equal(files['index.html'], html); return { elements: [{ id: 'e1' }], errors: [] }; },
    async execute(args) { interactions++; assert.equal(args.action, 'click'); return { observation: { errors: [] } }; },
  };
  responses = [{ content: html }, accepted,
    { tool_calls: [call('browser_action', { action: 'click', target: 'e1' })] }, accepted,
    { content: 'Built and checked the app.' }];
  result = await generate(null, false, false, browser);
  assert.equal(opens, 1, 'initial build opens in the embedded browser');
  assert.equal(interactions, 1);
  assert.equal(result.qualityReview.acceptable, true);
  assert.equal(result.qualityReview.browserTests[0].action, 'click');
  assert.equal(responses.length, 0);
  console.log('testCodeReviewPipeline: ok');
} finally {
  globalThis.fetch = savedFetch;
  await server.close();
}
