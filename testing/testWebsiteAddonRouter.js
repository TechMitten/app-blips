// Run: node testing/testWebsiteAddonRouter.js
// The add-on choice itself is an LLM call (routeWebsiteAddons in llm.js); this
// checks the parts around it: reading the reply and building the prompt.
import assert from 'node:assert/strict';
import { parseWebsiteAddons, buildWebsiteAddonDirective, describeWebsiteAddons, buildWebsiteInitialGenerationPrompt, buildHtmlSystemPrompt } from '../src/lib/prompts.js';

const replies = {
  'swiper, glightbox': ['swiper', 'glightbox'],
  'GLightbox,Swiper': ['swiper', 'glightbox'],
  '**leaflet**': ['leaflet'],
  'Chart.js, alpine.js': ['alpine', 'chart'],
  'gsap, aos, lenis': ['gsap', 'lenis'],
  'gsap, lenis, swiper, glightbox': ['gsap', 'lenis', 'swiper'],
  'none': [],
  'None.': [],
  'pixi': [],
  '': [],
};
for (const [reply, want] of Object.entries(replies)) {
  assert.deepEqual(parseWebsiteAddons(reply), want, `parse ${JSON.stringify(reply)}`);
}
assert.deepEqual(parseWebsiteAddons(undefined), []);

assert.equal(buildWebsiteAddonDirective([]), '');
assert.equal(
  buildWebsiteAddonDirective(['swiper', 'chart']),
  'ADD-ONS (chosen for this site): use Swiper, Chart.js, loaded and used exactly as the ADD-ON LIBRARIES section says. Do not load any other add-on.'
);

const withLine = buildWebsiteInitialGenerationPrompt('a bakery', '', buildWebsiteAddonDirective(['aos']));
assert.match(withLine, /request: a bakery\.\n\nADD-ONS \(chosen for this site\): use AOS,/);
assert.doesNotMatch(buildWebsiteInitialGenerationPrompt('a bakery', ''), /ADD-ONS \(/);

// Every add-on the directive can name has loading instructions in the prompt.
const systemLines = buildHtmlSystemPrompt('website').split('\n');
for (const name of ['GSAP + ScrollTrigger', 'AOS', 'Lenis', 'Swiper', 'GLightbox', 'Alpine.js', 'Chart.js', 'Leaflet']) {
  assert.ok(systemLines.some((line) => line.startsWith(`- ${name}`)), name);
}
assert.doesNotMatch(buildHtmlSystemPrompt('app'), /ADD-ON LIBRARIES/);

// The chat note names what will be used.
assert.equal(describeWebsiteAddons(['swiper', 'glightbox']), 'Add-ons: Swiper (carousels), GLightbox (full-screen photos).');
assert.match(describeWebsiteAddons([]), /^Add-ons: none\. This site doesn't need any/);
assert.match(describeWebsiteAddons([], { failed: true }), /didn't answer/);

console.log('ok');
