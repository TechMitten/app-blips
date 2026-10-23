// Run: node testing/testTokenUsage.js
// Providers report token counts on the last stream chunk (often one with no
// choices) or on a non-streamed reply; requestModelText records them so the
// transcript can show what each turn used.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const savedFetch = globalThis.fetch;
try {
  const { requestModelText } = await server.ssrLoadModule('/src/lib/llm.js');
  const { startUsageMeter, normalizeUsage, formatTokenCount, trackRequest, getLiveUsage, estimateRequestTokens } = await server.ssrLoadModule('/src/lib/tokenUsage.js');
  // Live updates are batched for a moment; wait one batch out.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  let responses = [];
  const sse = (chunks) => new Response(
    [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  globalThis.fetch = async () => {
    const next = responses.shift();
    assert.ok(next, 'unexpected API request');
    return next();
  };
  const messages = [{ role: 'user', content: 'hi' }];
  const stream = () => requestModelText({ messages, onChunk: () => {}, retry: false });

  // Usage on a chunk with an empty choices array (OpenAI) and on one with no
  // choices key at all; text still parses, and both requests are summed.
  let meter = startUsageMeter();
  responses = [
    () => sse([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } },
    ]),
    () => sse([
      { choices: [{ delta: { content: 'Again' }, finish_reason: 'stop' }] },
      { usage: { prompt_tokens: 800, completion_tokens: 50 } },
    ]),
  ];
  assert.equal((await stream()).content, 'Hello');
  assert.equal((await stream()).content, 'Again');
  assert.deepEqual(meter.stop(), { input: 2000, output: 350, calls: 2, reported: 2 });
  assert.deepEqual(meter.stop(), { input: 2000, output: 350, calls: 2, reported: 2 }, 'stop() is repeatable');

  // A request after stop() isn't counted.
  responses = [() => sse([{ choices: [], usage: { prompt_tokens: 5, completion_tokens: 5 } }])];
  await stream();
  assert.deepEqual(meter.stop(), { input: 2000, output: 350, calls: 2, reported: 2 });

  // Non-streamed reply with usage; a reply without usage counts as a call only.
  meter = startUsageMeter();
  responses = [
    () => Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 2 } }),
    () => sse([{ choices: [{ delta: { content: 'local' }, finish_reason: 'stop' }] }]),
  ];
  await requestModelText({ messages, retry: false });
  await stream();
  assert.deepEqual(meter.stop(), { input: 40, output: 2, calls: 2, reported: 1 });

  // Live counter (request JSON / 4 chars per token; {"messages":""} is 15
  // chars): an estimate while a request runs, swapped for the reported
  // counts when it finishes.
  meter = startUsageMeter();
  let live = trackRequest({ messages: 'x'.repeat(385) });
  await settle();
  assert.equal(getLiveUsage().estimating, true);
  live.streamed(40);
  await settle();
  assert.deepEqual(getLiveUsage(), { input: 100, output: 10, calls: 0, reported: 0, estimating: true });
  live.finish({ prompt_tokens: 120, completion_tokens: 9 });
  await settle();
  assert.deepEqual(getLiveUsage(), { input: 120, output: 9, calls: 1, reported: 1, estimating: false });
  // A request with no reported counts keeps its estimate in the live view
  // (so the counter doesn't drop), but not in the saved totals.
  live = trackRequest({ messages: 'x'.repeat(25) });
  live.streamed(8);
  live.finish(null);
  await settle();
  assert.deepEqual(getLiveUsage(), { input: 130, output: 11, calls: 2, reported: 1, estimating: true });
  // A failed request is dropped.
  live = trackRequest({ messages: 'x'.repeat(4000) });
  live.cancel();
  live.finish({ prompt_tokens: 999, completion_tokens: 999 });
  await settle();
  assert.equal(getLiveUsage().input, 130);
  assert.deepEqual(meter.stop(), { input: 120, output: 9, calls: 2, reported: 1 });
  assert.equal(getLiveUsage(), null, 'no live counter once the turn ends');

  // The live counter follows a streamed request through requestModelText.
  meter = startUsageMeter();
  responses = [() => sse([
    { choices: [{ delta: { content: 'x'.repeat(400) } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ])];
  await stream();
  await settle();
  assert.equal(getLiveUsage().output, 100);
  assert.equal(getLiveUsage().estimating, true);
  meter.stop();

  // An attached image counts as a flat amount, not its base64 length.
  const withImage = estimateRequestTokens({ messages: [{ content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(100_000)}` } }] }] });
  assert.ok(withImage > 1000 && withImage < 1100, String(withImage));

  assert.equal(normalizeUsage(undefined), null);
  assert.equal(normalizeUsage({}), null);
  assert.deepEqual(normalizeUsage({ prompt_tokens: 10 }), { input: 10, output: 0 });

  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(842), '842');
  assert.equal(formatTokenCount(1000), '1k');
  assert.equal(formatTokenCount(12_380), '12.4k');
  assert.equal(formatTokenCount(250_000), '250k');
  assert.equal(formatTokenCount(999_999), '1M');
  assert.equal(formatTokenCount(1_234_567), '1.2M');

  console.log('testTokenUsage: ok');
} finally {
  globalThis.fetch = savedFetch;
  await server.close();
}
