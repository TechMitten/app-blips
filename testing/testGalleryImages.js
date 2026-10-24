// Run: node testing/testGalleryImages.js
// "My images" (lib/galleryImages.js): names, the preview/export path rewrite,
// export file lists, and the prompt note (prompts.js buildImageGalleryNote).
import assert from 'node:assert/strict';

globalThis.window = { localStorage: { length: 0, getItem: () => null, setItem: () => {} } };

const {
  galleryName, renamedGalleryName, normalizeGallery, rewriteGalleryRefs, referencedGalleryImages,
  renameGalleryRefs, galleryExportFiles, inlineGalleryImages, setActiveGallery,
} = await import('../src/lib/galleryImages.js');
const { buildImageGalleryNote, buildHtmlSystemPrompt } = await import('../src/lib/prompts.js');
const { SITE_IMAGE_PATH_RE } = await import('../src/lib/siteImages.js');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const team = { hash: HASH_A, name: 'team-photo.jpg', type: 'image/jpeg', width: 1600, height: 1067, size: 3, note: 'Our team' };
const logo = { hash: HASH_B, name: 'logo.svg', type: 'image/svg+xml', width: 0, height: 0, size: 2, note: '' };
const images = [team, logo];

// --- Names ---
assert.equal(galleryName('Team Photo (1).JPG', 'image/jpeg'), 'team-photo-1.jpg');
assert.equal(galleryName('Café Ünïcode.png', 'image/webp'), 'cafe-unicode.webp');
assert.equal(galleryName('photo.jpg', 'image/jpeg', ['photo.jpg', 'photo-2.jpg']), 'photo-3.jpg');
assert.equal(galleryName('!!!.png', 'image/png'), 'image.png');
assert.ok(SITE_IMAGE_PATH_RE.test(`images/${galleryName('x'.repeat(300), 'image/jpeg')}`));
assert.equal(renamedGalleryName(team, 'Hero Shot', ['team-photo.jpg', 'logo.svg']), 'hero-shot.jpg');
assert.equal(renamedGalleryName(team, 'logo', ['team-photo.jpg', 'logo.jpg']), 'logo-2.jpg');
assert.equal(renamedGalleryName(team, 'team photo', ['team-photo.jpg']), 'team-photo.jpg');

// --- Saved rows are checked ---
assert.deepEqual(normalizeGallery([
  team,
  { ...team, name: 'dupe-hash-ok.jpg' },
  { ...team },                                   // duplicate name
  { ...team, name: '../evil.jpg' },
  { ...team, hash: 'nothex', name: 'x.jpg' },
  { ...team, type: 'text/html', name: 'y.jpg' },
  null,
]).map((image) => image.name), ['team-photo.jpg', 'dupe-hash-ok.jpg']);
assert.deepEqual(normalizeGallery('nope'), []);

// --- Rewrite: only gallery names, only standalone paths ---
const url = (image) => `blob:${image.name}`;
const html = `<img src="images/team-photo.jpg"><img src='./images/logo.svg'><div style="background:url(/images/team-photo.jpg)"></div>
<img src="images/other.png"><img src="assets/images/team-photo.jpg"><img src="https://x.com/images/team-photo.jpg">
<script>const a = 'images/team-photo.jpg'; const b = \`images/logo.svg\`;</script>
<img srcset="images/team-photo.jpg 2x"><img src="images/team-photo.jpgx"><img src="https://media.pollinations.ai/abc">`;
const out = rewriteGalleryRefs(html, images, url);
assert.match(out, /<img src="blob:team-photo\.jpg">/);
assert.match(out, /<img src='blob:logo\.svg'>/);
assert.match(out, /url\(blob:team-photo\.jpg\)/);
assert.match(out, /'blob:team-photo\.jpg'/);
assert.match(out, /`blob:logo\.svg`/);
assert.match(out, /srcset="blob:team-photo\.jpg 2x"/);
assert.match(out, /"images\/other\.png"/);
assert.match(out, /"assets\/images\/team-photo\.jpg"/);
assert.match(out, /"https:\/\/x\.com\/images\/team-photo\.jpg"/);
assert.match(out, /"images\/team-photo\.jpgx"/);
assert.match(out, /media\.pollinations\.ai\/abc/);
// No URL available (bytes not loaded): the path stays.
assert.equal(rewriteGalleryRefs('<img src="images/logo.svg">', images, () => ''), '<img src="images/logo.svg">');
assert.equal(rewriteGalleryRefs(html, [], url), html);

// --- Which images pages use, and rename ---
const files = { 'index.html': '<img src="images/team-photo.jpg">', 'about.html': '<p>images/nothing.png</p>' };
assert.deepEqual(referencedGalleryImages(files, images).map((image) => image.name), ['team-photo.jpg']);
assert.deepEqual(
  renameGalleryRefs({ 'index.html': '<img src="./images/team-photo.jpg"><img src="images/team-photo.jpg.bak">' }, 'team-photo.jpg', 'hero.jpg'),
  { 'index.html': '<img src="./images/hero.jpg"><img src="images/team-photo.jpg.bak">' },
);

// --- Export: only referenced images whose bytes are available ---
const bytes = { [HASH_A]: new Uint8Array([1, 2, 3]) };
const exportFiles = galleryExportFiles(files, images, (hash) => bytes[hash]);
assert.deepEqual(exportFiles.map((file) => file.path), ['images/team-photo.jpg']);
assert.deepEqual(galleryExportFiles({ 'index.html': '<img src="images/logo.svg">' }, images, (hash) => bytes[hash]), []);
assert.equal(inlineGalleryImages(files, exportFiles)['index.html'], '<img src="data:image/jpeg;base64,AQID">');

// --- Prompt note ---
const note = buildImageGalleryNote(images, 'website');
assert.match(note, /^USER IMAGES:/);
assert.match(note, /- images\/team-photo\.jpg \(1600×1067\) — the user's note: Our team/);
assert.match(note, /- images\/logo\.svg \(vector\)$/m);
assert.doesNotMatch(note, /exception/);
assert.match(buildImageGalleryNote(images, 'game'), /one exception/);
assert.equal(buildImageGalleryNote([], 'app'), '');
// The system prompt picks up the open project's gallery.
const plain = buildHtmlSystemPrompt('app', []);
setActiveGallery(images);
assert.ok(buildHtmlSystemPrompt('app', []).includes('images/team-photo.jpg'));
assert.ok(buildHtmlSystemPrompt('app', []).startsWith(plain));
setActiveGallery([]);
assert.equal(buildHtmlSystemPrompt('app', []), plain);

// --- The preview copy points at loadable URLs; stored files never change ---
const { injectPreviewBridge } = await import('../src/previewBridge.js');
const stored = '<html><head></head><body><img src="images/team-photo.jpg"></body></html>';
const { srcDoc } = injectPreviewBridge(stored, { gallery: { images, toUrl: () => 'data:image/jpeg;base64,AQID' } });
assert.ok(srcDoc.includes('<img src="data:image/jpeg;base64,AQID">'));
assert.ok(!srcDoc.includes('images/team-photo.jpg'));
assert.ok(injectPreviewBridge(stored).srcDoc.includes('images/team-photo.jpg'));

console.log('testGalleryImages: all passed');
