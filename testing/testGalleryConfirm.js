// Run: node testing/testGalleryConfirm.js
// Confirming My images matches before a build (llm.js matchGalleryImages and
// the pause in generateAppCode; wording and helpers in galleryImages.js).
// Vite resolves the renderer's extensionless imports. Scripted API responses
// stand in for the AI provider, so no tokens are spent.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// My images is on (connectors.js reads this through safeStorage).
const connectorsOn = JSON.stringify({ images: { enabled: true, key: '' } });
globalThis.window = { localStorage: { length: 0, getItem: () => connectorsOn, setItem: () => {}, removeItem: () => {} } };

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const savedFetch = globalThis.fetch;
try {
  const { generateAppCode } = await server.ssrLoadModule('/src/lib/llm.js');
  const {
    setActiveGallery, mightMentionGalleryImage, isImageApproval, imageApprovalText, buildImageConfirmReply,
  } = await server.ssrLoadModule('/src/lib/galleryImages.js');

  const lake = { hash: 'a'.repeat(64), name: 'mountain-lake-sunset.jpg', type: 'image/jpeg', width: 1280, height: 853, size: 1, note: 'Pixabay photo: mountain, lake' };
  const beach = { hash: 'b'.repeat(64), name: 'tropical-beach.jpg', type: 'image/jpeg', width: 1280, height: 853, size: 1, note: '' };
  setActiveGallery([lake, beach]);

  // Helpers.
  assert.equal(mightMentionGalleryImage('Use the mountain lake photo as the hero', [lake]), true);
  assert.equal(mightMentionGalleryImage('put tropical-beach in the footer', [beach]), true, 'a word of a name counts');
  assert.equal(mightMentionGalleryImage('Make the title red', [lake, beach]), false);
  assert.equal(mightMentionGalleryImage('Add a photo', []), false);
  for (const text of ['Yes, use mountain-lake-sunset.jpg.', 'yes', 'OK go ahead', 'Sounds good!']) assert.equal(isImageApproval(text), true, text);
  for (const text of ['no, the beach one', 'use tropical-beach instead', '']) assert.equal(isImageApproval(text), false, text);
  assert.equal(imageApprovalText([{ mentioned: 'a', image: 'x.jpg' }, { mentioned: 'b', image: 'x.jpg' }]), 'Yes, use x.jpg.');
  const { reply, allMatched } = buildImageConfirmReply([{ mentioned: 'the lake photo', image: lake.name }], [lake, beach]);
  assert.equal(allMatched, true);
  assert.match(reply, /“the lake photo” → \*\*mountain-lake-sunset\.jpg\*\*/);
  assert.match(reply, /Yes, use it/);
  const unclear = buildImageConfirmReply([{ mentioned: 'the city', image: '' }], [lake, beach]);
  assert.equal(unclear.allMatched, false);
  assert.match(unclear.reply, /no image in My images matches/);
  assert.match(unclear.reply, /tropical-beach\.jpg/);

  // The pipeline, with a scripted provider.
  const html = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hi</h1></body></html>';
  const call = (name, args) => ({ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  let responses = [];
  let requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const response = responses.shift();
    assert.ok(response, 'unexpected API request');
    return Response.json({ choices: [{ message: response }] });
  };
  const generate = (prompt, confirm, history = []) => generateAppCode(
    prompt, null, history, null, 'both', null, false, false, null, false,
    { build: 'none' }, 'app', null, '', false, false, '', confirm,
  );

  // A request naming an image stops for confirmation; the tool lists only real names.
  requests = [];
  responses = [{ tool_calls: [call('report_image_matches', { matches: [{ mentioned: 'the mountain lake photo', image: lake.name }] })] }];
  let result = await generate('Use the mountain lake photo as the hero background', true);
  assert.equal(result.editMode, 'clarify');
  assert.deepEqual(result.imageConfirm, { matches: [{ mentioned: 'the mountain lake photo', image: lake.name }], allMatched: true });
  assert.match(result.reply, /\*\*mountain-lake-sunset\.jpg\*\*/);
  assert.equal(requests.length, 1, 'nothing is built before the user approves');
  const tool = requests[0].tools[0].function;
  assert.equal(tool.name, 'report_image_matches');
  assert.deepEqual(tool.parameters.properties.matches.items.properties.image.enum, [lake.name, beach.name, '']);
  assert.match(requests[0].messages[0].content, /mountain-lake-sunset\.jpg \(note: Pixabay photo: mountain, lake\)/);

  // A name the provider makes up is never offered as a match.
  responses = [{ tool_calls: [call('report_image_matches', { matches: [{ mentioned: 'the city', image: 'city.jpg' }] })] }];
  result = await generate('Use the city image in the header', true);
  assert.deepEqual(result.imageConfirm.matches, [{ mentioned: 'the city', image: '' }]);
  assert.equal(result.imageConfirm.allMatched, false);

  // No image words: no check, straight to the build.
  requests = [];
  responses = [{ content: html }, { content: 'Made the title red.' }];
  result = await generate('Make the title red', true);
  assert.equal(result.editMode, 'full-generation');
  assert.ok(!requests.some((req) => req.tools?.some((t) => t.function.name === 'report_image_matches')));

  // Approved (App passes false): the build goes ahead without asking again.
  requests = [];
  responses = [{ content: html }, { content: 'Added the photo.' }];
  result = await generate('Yes, use mountain-lake-sunset.jpg.', false, [
    { role: 'user', content: 'Use the mountain lake photo as the hero background' },
    { role: 'assistant', content: 'Before I start, please check the image…' },
  ]);
  assert.equal(result.editMode, 'full-generation');
  assert.ok(!requests.some((req) => req.tools?.some((t) => t.function.name === 'report_image_matches')));

  // An answer to the confirmation is checked even without image words.
  requests = [];
  responses = [{ tool_calls: [call('report_image_matches', { matches: [{ mentioned: 'the beach one', image: beach.name }] })] }];
  result = await generate('no, the beach one', 'answer', [
    { role: 'user', content: 'Use the mountain lake photo as the hero background' },
    { role: 'assistant', content: 'Before I start, please check the image…' },
  ]);
  assert.equal(result.editMode, 'clarify');
  assert.equal(result.imageConfirm.matches[0].image, beach.name);

  // The provider doesn't call the tool, or fails: build as usual.
  responses = [{ content: 'no tool' }, { content: html }, { content: 'Done.' }];
  result = await generate('Add a hero image', true);
  assert.equal(result.editMode, 'full-generation');

  // My images off: never asks.
  setActiveGallery([]);
  requests = [];
  responses = [{ content: html }, { content: 'Done.' }];
  result = await generate('Use the mountain lake photo', true);
  assert.equal(result.editMode, 'full-generation');
  assert.equal(responses.length, 0);

  console.log('testGalleryConfirm: all passed');
} finally {
  globalThis.fetch = savedFetch;
  await server.close();
}
