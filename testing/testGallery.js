import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCount, timeAgo, hotScore, avatarGradient, avatarInitial,
  parseGalleryRoute, buildGalleryHref, galleryShareUrl,
} from '../src/lib/galleryFormat.js';

test('formatCount matches the card pill style', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(42), '42');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1k');
  assert.equal(formatCount(1234), '1.2k');
  assert.equal(formatCount(2700), '2.7k');
  assert.equal(formatCount(45000), '45k');
  assert.equal(formatCount(263400), '263k');
  assert.equal(formatCount(999999), '999k');
  assert.equal(formatCount(1_000_000), '1M');
  assert.equal(formatCount(2_150_000), '2.1M');
  assert.equal(formatCount(-5), '0');
  assert.equal(formatCount(undefined), '0');
});

test('timeAgo is compact and clamps the future to "just now"', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(timeAgo('2026-09-29T11:59:30Z', now), 'just now');
  assert.equal(timeAgo('2026-09-29T11:55:00Z', now), '5m ago');
  assert.equal(timeAgo('2026-09-29T09:00:00Z', now), '3h ago');
  assert.equal(timeAgo('2026-09-27T12:00:00Z', now), '2d ago');
  assert.equal(timeAgo('2026-09-01T12:00:00Z', now), '4w ago');
  assert.equal(timeAgo('2026-09-30T12:00:00Z', now), 'just now');
  assert.equal(timeAgo('not a date', now), '');
});

test('hotScore favors engagement but decays with age', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const hour = 3600 * 1000;
  const fresh = { likes_count: 2, created_at: new Date(now - hour).toISOString() };
  const stale = { likes_count: 20, created_at: new Date(now - 30 * 24 * hour).toISOString() };
  const popular = { likes_count: 40, comments_count: 5, created_at: new Date(now - hour).toISOString() };
  assert.ok(hotScore(fresh, now) > hotScore(stale, now));
  assert.ok(hotScore(popular, now) > hotScore(fresh, now));
});

test('avatars are stable per username', () => {
  assert.equal(avatarGradient('techray'), avatarGradient('techray'));
  assert.notEqual(avatarGradient('techray'), avatarGradient('kengine'));
  assert.equal(avatarInitial('techray'), 'T');
  assert.equal(avatarInitial(''), '?');
});

test('parseGalleryRoute reads ?gallery and validated ?app ids', () => {
  const id = '3f87ac86-d7bf-407c-bc7f-ce0c0d72b672';
  assert.deepEqual(parseGalleryRoute(''), { open: false, postId: null });
  assert.deepEqual(parseGalleryRoute('?gallery'), { open: true, postId: null });
  assert.deepEqual(parseGalleryRoute(`?app=${id}`), { open: true, postId: id });
  assert.deepEqual(parseGalleryRoute(`?app=${id.toUpperCase()}`), { open: true, postId: id });
  assert.deepEqual(parseGalleryRoute('?app=../../etc'), { open: false, postId: null });
  assert.deepEqual(parseGalleryRoute('?app=nope&gallery'), { open: true, postId: null });
});

test('buildGalleryHref rewrites only gallery params', () => {
  const id = '3f87ac86-d7bf-407c-bc7f-ce0c0d72b672';
  assert.equal(buildGalleryHref('https://appblips.com/', { open: true }), 'https://appblips.com/?gallery');
  assert.equal(buildGalleryHref('https://appblips.com/?gallery', { open: true, postId: id }), `https://appblips.com/?app=${id}`);
  assert.equal(buildGalleryHref(`https://appblips.com/?app=${id}`, { open: false }), 'https://appblips.com/');
  assert.equal(buildGalleryHref('https://appblips.com/?x=1#h', { open: true }), 'https://appblips.com/?x=1&gallery#h');
  // Round-trips through the parser.
  assert.deepEqual(parseGalleryRoute(new URL(buildGalleryHref('https://a.test/', { open: true, postId: id })).search), { open: true, postId: id });
});

test('galleryShareUrl builds a deep link on the SPA origin', () => {
  assert.equal(galleryShareUrl('https://appblips.com/', 'abc'), 'https://appblips.com/?app=abc');
  assert.equal(galleryShareUrl('http://localhost:5175', 'abc'), 'http://localhost:5175/?app=abc');
});
