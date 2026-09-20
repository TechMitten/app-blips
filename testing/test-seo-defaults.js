// Run: node testing/test-seo-defaults.js
import assert from 'node:assert/strict';
import { injectSeoDefaults } from '../functions/_lib/seoDefaults.js';

const url = 'https://my.appblips.com/demo';
const page = '<!DOCTYPE html><html><head><title>Joe &amp; Co Bakery</title></head><body><h1>Fresh bread</h1><script>var p="<p>fake paragraph that is long enough to match</p>"</script><p>We bake sourdough, rye and seasonal pastries every morning in the heart of town.</p></body></html>';

const out = injectSeoDefaults(page, { url });
assert.match(out, /<html lang="en">/);
assert.match(out, /<link rel="canonical" href="https:\/\/my\.appblips\.com\/demo">/);
assert.match(out, /<meta name="description" content="We bake sourdough/);
assert.doesNotMatch(out.match(/<meta name="description"[^>]*>/)[0], /fake paragraph/);
assert.match(out, /og:title" content="Joe &amp;amp; Co Bakery|og:title" content="Joe &amp; Co Bakery/);
assert.equal((out.match(/rel="canonical"/g) || []).length, 1);

// Idempotent: a second pass adds nothing.
assert.equal(injectSeoDefaults(out, { url }), out);

// Never overwrites what the page already declares.
const own = '<html lang="fr"><head><title>T</title><meta name="description" content="mine"><link rel="canonical" href="https://x.test/"><meta property="og:title" content="og"></head><body><p>' + 'x'.repeat(60) + '</p></body></html>';
const kept = injectSeoDefaults(own, { url });
assert.match(kept, /lang="fr"/);
assert.equal((kept.match(/name="description"/g) || []).length, 1);
assert.equal((kept.match(/rel="canonical"/g) || []).length, 1);
assert.equal((kept.match(/property="og:title"/g) || []).length, 1);

// noindex pages (password wrapper, opted-out deploys) are untouched.
const locked = '<html lang="en"><head><meta name="robots" content="noindex"><title>Protected App</title></head><body></body></html>';
assert.equal(injectSeoDefaults(locked, { url }), locked);

// No <head>/<html>: still returns a string with the tags prepended.
assert.match(injectSeoDefaults('<p>hi</p>', { url }), /^<link rel="canonical"/);
console.log('seo defaults ok');
