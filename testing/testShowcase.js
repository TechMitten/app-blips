import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeProject, normalizeProjects, parseShowcaseRoute, buildShowcaseHref, showcaseShareUrl,
  parseRemixSource, fallbackGradient,
} from '../src/lib/showcase.js';

const base = { id: 'pixel-pets', title: 'Pixel Pets', url: 'https://my.appblips.com/me/pixel-pets' };

test('normalizeProject fills defaults and rejects unusable entries', () => {
  const { project } = normalizeProject({ ...base, title: '  Pixel Pets ' });
  assert.deepEqual(project, {
    id: 'pixel-pets', title: 'Pixel Pets', description: '', kind: 'app', url: base.url,
    thumbnail: null, device: 'desktop', prompt: '', source: null,
  });
  assert.equal(normalizeProject({ ...base, kind: 'game', device: 'mobile' }).project.kind, 'game');
  assert.equal(normalizeProject({ ...base, kind: 'nope', device: 'watch' }).project.device, 'desktop');
  assert.equal(normalizeProject({ ...base, id: 'Bad Id' }).project, null);
  assert.equal(normalizeProject({ ...base, id: '-x' }).project, null);
  assert.equal(normalizeProject({ ...base, title: ' ' }).project, null);
  assert.equal(normalizeProject({ ...base, url: 'javascript:alert(1)' }).project, null);
  assert.equal(normalizeProject({ ...base, thumbnail: '//evil.test/x.jpg' }).project, null);
  assert.equal(normalizeProject({ ...base, thumbnail: '/showcase/x.jpg' }).project.thumbnail, '/showcase/x.jpg');
  assert.equal(normalizeProject(null).project, null);
});

test('normalizeProjects drops invalid and duplicate ids with a warning', () => {
  const warnings = [];
  const list = normalizeProjects([base, { ...base, title: 'Dupe' }, { id: 'x' }, { ...base, id: 'two' }], (m) => warnings.push(m));
  assert.deepEqual(list.map((p) => p.id), ['pixel-pets', 'two']);
  assert.equal(warnings.length, 2);
});

test('parseShowcaseRoute reads ?showcase and maps legacy gallery links', () => {
  assert.deepEqual(parseShowcaseRoute(''), { open: false, projectId: null });
  assert.deepEqual(parseShowcaseRoute('?showcase'), { open: true, projectId: null });
  assert.deepEqual(parseShowcaseRoute('?showcase=pixel-pets'), { open: true, projectId: 'pixel-pets' });
  assert.deepEqual(parseShowcaseRoute('?showcase=../../etc'), { open: true, projectId: null });
  assert.deepEqual(parseShowcaseRoute('?gallery'), { open: true, projectId: null });
  assert.deepEqual(parseShowcaseRoute('?app=3f87ac86-d7bf-407c-bc7f-ce0c0d72b672'), { open: true, projectId: null });
});

test('buildShowcaseHref rewrites only showcase params', () => {
  assert.equal(buildShowcaseHref('https://appblips.com/', { open: true }), 'https://appblips.com/?showcase');
  assert.equal(buildShowcaseHref('https://appblips.com/?showcase', { open: true, projectId: 'a-b' }), 'https://appblips.com/?showcase=a-b');
  assert.equal(buildShowcaseHref('https://appblips.com/?showcase=a-b', { open: false }), 'https://appblips.com/');
  assert.equal(buildShowcaseHref('https://appblips.com/?gallery', { open: false }), 'https://appblips.com/');
  assert.equal(buildShowcaseHref('https://appblips.com/?x=1#h', { open: true }), 'https://appblips.com/?x=1&showcase#h');
  assert.deepEqual(
    parseShowcaseRoute(new URL(buildShowcaseHref('https://a.test/', { open: true, projectId: 'a-b' })).search),
    { open: true, projectId: 'a-b' },
  );
});

test('showcaseShareUrl builds a deep link on the SPA origin', () => {
  assert.equal(showcaseShareUrl('https://appblips.com/', 'abc'), 'https://appblips.com/?showcase=abc');
});

test('parseRemixSource accepts a single HTML file or a files map', () => {
  const project = normalizeProject({ ...base, kind: 'game' }).project;
  assert.deepEqual(parseRemixSource(project, '<!doctype html><p>hi</p>', true), {
    files: { 'index.html': '<!doctype html><p>hi</p>' }, studioMode: 'game',
  });
  assert.deepEqual(
    parseRemixSource(project, { files: { 'index.html': 'a', 'about.html': 'b' }, studioMode: 'website', aiEnabled: 1 }, false),
    { files: { 'index.html': 'a', 'about.html': 'b' }, studioMode: 'website' },
  );
  assert.throws(() => parseRemixSource(project, '  ', true), /empty/);
  assert.throws(() => parseRemixSource(project, { files: { 'about.html': 'b' } }, false), /landing page/);
  assert.throws(() => parseRemixSource(project, { files: { '../x.html': 'b' } }, false), /invalid/);
  assert.throws(() => parseRemixSource(project, { files: [] }, false), /invalid/);
});

test('fallback gradients are stable per id', () => {
  assert.equal(fallbackGradient('a'), fallbackGradient('a'));
  assert.notEqual(fallbackGradient('a'), fallbackGradient('b'));
});
