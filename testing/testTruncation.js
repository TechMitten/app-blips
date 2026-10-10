// Run: node testing/testTruncation.js
// Providers stop at their output limit with finish_reason 'length'. A page cut
// off there must be continued, not handed to search/replace repairs.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const savedFetch = globalThis.fetch;
try {
  const { requestFullText, generateAppCode, executeRefinementTool, CONTINUE_INSTRUCTION, MAX_CONTINUATIONS } = await server.ssrLoadModule('/src/lib/llm.js');
  const { sanitizeHtmlResponse } = await server.ssrLoadModule('/src/lib/edits.js');
  const { checkSyntax } = await server.ssrLoadModule('/src/lib/syntaxCheck.js');

  let responses = [];
  let requests = [];
  const sse = (parts, finishReason) => new Response([
    ...parts.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join(''), { headers: { 'content-type': 'text/event-stream' } });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const next = responses.shift();
    assert.ok(next, 'unexpected API request');
    if (body.stream) return sse(next.parts, next.finish);
    return Response.json({ choices: [{ message: next.message, finish_reason: next.finish }] });
  };

  // Streaming: the cut-off page is continued, a reopened fence is dropped, and
  // the live view receives one seamless document.
  const head = '```html\n<!DOCTYPE html><html><body><script>const total = ';
  const tail = '1 + 2;</script></body></html>\n```';
  responses = [
    { parts: ['Here you go.\n', head], finish: 'length' },
    { parts: ['```html\n', tail], finish: 'stop' },
  ];
  requests = [];
  let streamed = '';
  const statuses = [];
  const reply = await requestFullText({
    messages: [{ role: 'user', content: 'Build it' }],
    onChunk: (chunk, kind) => { if (kind === 'content') streamed += chunk; if (kind === 'status') statuses.push(chunk); },
    retry: false,
  });
  assert.equal(reply.content, `Here you go.\n${head}${tail}`);
  assert.equal(streamed, reply.content, 'the live view sees exactly the joined text');
  assert.equal(reply.truncated, undefined);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages.slice(-2), [
    { role: 'assistant', content: `Here you go.\n${head}` },
    { role: 'user', content: CONTINUE_INSTRUCTION },
  ]);
  assert.ok(statuses.some((s) => /length limit/.test(s)));
  const html = sanitizeHtmlResponse(reply.content);
  assert.equal(checkSyntax(html).errors.length, 0, 'the joined page parses');

  // Continuations are bounded and the result is marked as still cut off.
  responses = Array.from({ length: MAX_CONTINUATIONS + 1 }, () => ({ parts: ['x'], finish: 'length' }));
  requests = [];
  const capped = await requestFullText({ messages: [{ role: 'user', content: 'Build it' }], onChunk: () => {}, retry: false });
  assert.equal(requests.length, MAX_CONTINUATIONS + 1);
  assert.equal(capped.content, 'x'.repeat(MAX_CONTINUATIONS + 1));
  assert.equal(capped.truncated, true);

  // Full generation (non-streamed): the build comes back whole, with no
  // syntax errors and no repair round.
  const generate = () => generateAppCode('Build it', null, [], null, 'both', null, false, false, null, false, { build: 'none' }, 'app', null, '', false);
  responses = [
    { message: { content: head }, finish: 'length' },
    { message: { content: tail }, finish: 'stop' },
    { message: { content: 'Built your app.' }, finish: 'stop' },
  ];
  requests = [];
  let result = await generate();
  assert.equal(result.syntaxErrors, undefined);
  assert.equal(result.syntaxAutoFixAttempted, false);
  assert.equal(result.outputTruncated, undefined);
  assert.ok(!requests.some((req) => req.tools), 'no surgical repair was needed');
  assert.equal(checkSyntax(result.code).errors.length, 0);

  // Still cut off after every continuation: the reply says why. (No script,
  // so the syntax gate has nothing to repair.)
  responses = [
    ...Array.from({ length: MAX_CONTINUATIONS + 1 }, (_, i) => ({ message: { content: i ? '<p>more' : '<!DOCTYPE html><html><body><p>Hi' }, finish: 'length' })),
    { message: { content: 'Built your app.' }, finish: 'stop' },
  ];
  result = await generate();
  assert.equal(responses.length, 0);
  assert.equal(result.outputTruncated, true);
  assert.match(result.reply, /reached its output limit/);

  // A tool call cut off mid-arguments tells the model how to recover.
  const cutOff = executeRefinementTool('<html></html>', { id: 'c1', type: 'function', function: { name: 'apply_surgical_edits', arguments: '{"edits":[{"search":"<ht' } });
  assert.equal(cutOff.applied, false);
  assert.match(cutOff.result.error, /cut off by the output limit/);
  assert.match(cutOff.result.error, /smaller tool calls/);

  console.log('Truncation: continuation, fence handling, bounds, full-generation, reply note and cut-off tool calls passed.');
} finally {
  globalThis.fetch = savedFetch;
  await server.close();
}
