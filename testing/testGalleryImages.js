// Run: node testing/testGalleryImages.js
// "My images" (lib/galleryImages.js): names, the preview/export path rewrite,
// export file lists, and the prompt note (prompts.js buildImageGalleryNote).
import assert from 'node:assert/strict';

// My images is off by default, and the AI only hears about images while it is on.
const connectorsOn = JSON.stringify({ images: { enabled: true, key: '' } });
globalThis.window = { localStorage: { length: 0, getItem: () => connectorsOn, setItem: () => {} } };

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

// Near misses the AI writes for a gallery image become images/<name>, so the
// preview and export find it; anything not clearly one of them is left alone.
{
  const { normalizeGalleryRefs } = await import('../src/lib/galleryImages.js');
  const logoPng = { ...logo, hash: 'c'.repeat(64), name: 'logo.png', type: 'image/png' };
  const fix = (text) => normalizeGalleryRefs({ 'index.html': text }, [team, logo, logoPng])['index.html'];
  assert.strictEqual(fix('<img src="team-photo.jpg" alt="Team">'), '<img src="images/team-photo.jpg" alt="Team">');
  assert.strictEqual(fix('<img src={"team-photo.jpg"} />'), '<img src={"images/team-photo.jpg"} />');
  assert.strictEqual(fix("<img src='images/team-photo.jpeg'>"), "<img src='images/team-photo.jpg'>");
  assert.strictEqual(fix('<img src="images/team-photo">'), '<img src="images/team-photo.jpg">');
  assert.strictEqual(fix('<img src="images/Team-Photo.JPG">'), '<img src="images/team-photo.jpg">');
  assert.strictEqual(fix('<img src="./assets/images/team-photo.jpg">'), '<img src="images/team-photo.jpg">');
  assert.strictEqual(fix('background: url(team-photo.jpg)'), 'background: url(images/team-photo.jpg)');
  assert.strictEqual(fix("background: url('img/team-photo.webp')"), "background: url('images/team-photo.jpg')");
  // Already right, not a gallery image, or not clearly one: unchanged.
  for (const text of [
    '<img src="images/team-photo.jpg">',
    '<img src="/images/team-photo.jpg">',
    '<img src="./images/team-photo.jpg">',
    '<img src="other.jpg">',
    '<img src="vendor/team-photo.jpg">',
    '<img src="https://example.com/team-photo.jpg">',
    '<img alt="team-photo" src="x.png">',
    "const photos = [{ file: 'team-photo.jpg' }]; <img src={`images/${p.file}`} />",
    '<img src="images/logo">',
    '<img src="logo">',
  ]) assert.strictEqual(fix(text), text, text);
  assert.strictEqual(fix('<img src="images/logo.SVG">'), '<img src="images/logo.svg">');
  const files = { 'index.html': '<p>x</p>' };
  assert.strictEqual(normalizeGalleryRefs(files, []), files);
}

// Loose names the AI made up from the user's words find the closest real image.
{
  const { normalizeGalleryRefs, closestGalleryImage, unmatchedGalleryRefs } = await import('../src/lib/galleryImages.js');
  const lake = { hash: 'd'.repeat(64), name: 'mountain-lake-sunset.jpg', type: 'image/jpeg', note: 'Pixabay photo by alice: mountain, lake, sunset, nature' };
  const beach = { hash: 'e'.repeat(64), name: 'tropical-beach.jpg', type: 'image/jpeg', note: 'Pixabay photo: palm, sea, sand' };
  const gallery = [team, lake, beach];
  const fix = (text, images = gallery, all = images) => normalizeGalleryRefs({ 'index.html': text }, images, all)['index.html'];

  assert.strictEqual(closestGalleryImage('mountain-lake', gallery), lake);
  assert.strictEqual(closestGalleryImage('lake photo', gallery), lake);
  assert.strictEqual(closestGalleryImage('mountains', gallery), lake);
  assert.strictEqual(closestGalleryImage('sunset-lake-mountain', gallery), lake);
  assert.strictEqual(closestGalleryImage('palm-sea', gallery), beach, 'note words count too');
  assert.strictEqual(closestGalleryImage('team', gallery), team);
  assert.strictEqual(closestGalleryImage('city-skyline', gallery), null, 'nothing close: no guess');
  assert.strictEqual(closestGalleryImage('photo', gallery), null, 'filler words alone: no guess');
  const twins = [{ ...lake, name: 'lake-day.jpg', note: '' }, { ...beach, name: 'lake-night.jpg', note: '' }];
  assert.strictEqual(closestGalleryImage('lake', twins), null, 'a tie: no guess');

  assert.strictEqual(fix('<img src="images/mountain-lake.jpg">'), '<img src="images/mountain-lake-sunset.jpg">');
  assert.strictEqual(fix('<img src="images/lake.png">'), '<img src="images/mountain-lake-sunset.jpg">');
  assert.strictEqual(fix('<div style="background:url(images/beach.jpg)">'), '<div style="background:url(images/tropical-beach.jpg)">');
  assert.strictEqual(fix('<img src="images/city-skyline.jpg">'), '<img src="images/city-skyline.jpg">');
  assert.strictEqual(fix('<img src="images/anything.jpg">', [lake]), '<img src="images/mountain-lake-sunset.jpg">', 'one image: the gallery folder means it');
  assert.strictEqual(fix('<img src="assets/anything.jpg">', [lake]), '<img src="assets/anything.jpg">');
  // A page already showing a hidden image keeps it; it is no match for guesses.
  const hiddenLake = { ...lake, enabled: false };
  assert.strictEqual(fix('<img src="images/mountain-lake-sunset.jpg">', [team, beach], [team, beach, hiddenLake]), '<img src="images/mountain-lake-sunset.jpg">');
  assert.strictEqual(fix('<img src="images/mountain-lake.jpg">', [team, beach], [team, beach, hiddenLake]), '<img src="images/mountain-lake.jpg">');

  assert.deepStrictEqual(unmatchedGalleryRefs({ 'index.html': '<img src="images/team-photo.jpg"><img src="images/city.jpg">' }, gallery), ['images/city.jpg']);
  assert.deepStrictEqual(unmatchedGalleryRefs({ 'index.html': '<img src="images/mountain-lake-sunset.jpg">' }, [hiddenLake]), []);
}

// The name forms the My images example prompts use; the partial one still
// finds its image when other images share words.
{
  const { galleryNameForms, closestGalleryImage } = await import('../src/lib/galleryImages.js');
  const lake = { name: 'mountain-lake-sunset.jpg', note: '' };
  assert.deepStrictEqual(galleryNameForms('mountain-lake-sunset.jpg', [lake]), { name: 'mountain-lake-sunset.jpg', stem: 'mountain-lake-sunset', partial: 'mountain lake' });
  assert.deepStrictEqual(galleryNameForms('team-photo.jpg'), { name: 'team-photo.jpg', stem: 'team-photo', partial: 'team' });
  assert.strictEqual(galleryNameForms('logo.svg', [{ name: 'logo.svg' }]).partial, 'logo');
  const lakeNight = { name: 'mountain-lake-night.jpg', note: '' };
  const forms = galleryNameForms(lake.name, [lake, lakeNight]);
  assert.strictEqual(forms.partial, 'mountain lake sunset', 'shared words: more words until it is unambiguous');
  assert.strictEqual(closestGalleryImage(forms.partial, [lake, lakeNight]), lake);
}

// The AI is told to match an actual listed image, never a made-up path.
{
  const note = buildImageGalleryNote([team]);
  assert.match(note, /match the request to an actual image in the list/);
  assert.match(note, /Never write a path that isn't in the list/);
}

// The AI is told to write the whole listed path, not a bare name or a built one.
{
  const note = buildImageGalleryNote([team]);
  assert.match(note, /never a bare file name/);
  assert.match(note, /never build the path from parts/i);
}

console.log('testGalleryImages: all passed');

// --- Hidden images and the My images switch ---
{
  const { setActiveGallery, getActiveGallery, normalizeGallery } = await import('../src/lib/galleryImages.js');
  const hiddenLogo = { ...logo, enabled: false };
  setActiveGallery([team, hiddenLogo]);
  assert.deepStrictEqual(getActiveGallery().map((i) => i.name), ['team-photo.jpg']);
  assert.strictEqual(normalizeGallery([hiddenLogo])[0].enabled, false);
  assert.ok(!('enabled' in normalizeGallery([team])[0]));
}
