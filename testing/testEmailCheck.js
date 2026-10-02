import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPlausibleEmail, suggestEmailFix } from '../src/lib/emailCheck.js';

test('suggestEmailFix corrects common provider typos', () => {
  assert.equal(suggestEmailFix('sam@gmial.com'), 'sam@gmail.com');
  assert.equal(suggestEmailFix('sam@gamil.com'), 'sam@gmail.com');
  assert.equal(suggestEmailFix('sam@gmail.con'), 'sam@gmail.com');
  assert.equal(suggestEmailFix('sam@gmail.co'), 'sam@gmail.com');
  assert.equal(suggestEmailFix('sam@hotmial.com'), 'sam@hotmail.com');
  assert.equal(suggestEmailFix('sam@outlok.com'), 'sam@outlook.com');
  assert.equal(suggestEmailFix('sam@yaho.com'), 'sam@yahoo.com');
  assert.equal(suggestEmailFix('  Sam.Lee@GMAIL.CON '), 'Sam.Lee@gmail.com');
  assert.equal(suggestEmailFix('sam@example.con'), 'sam@example.com');
});

test('suggestEmailFix leaves real and unknown domains alone', () => {
  for (const email of [
    'sam@gmail.com', 'sam@email.com', 'sam@protonmail.ch', 'sam@hotmail.fr',
    'sam@outlook.de', 'sam@web.dk', 'sam@gmx.at', 'sam@company.io',
    'sam@mycompany.com', 'sam@uni.edu', 'not-an-email', '', null,
  ]) assert.equal(suggestEmailFix(email), null, email);
});

test('isPlausibleEmail rejects addresses that cannot be delivered', () => {
  assert.ok(isPlausibleEmail('sam@gmail.com'));
  assert.ok(isPlausibleEmail('sam+tag@mail.example.co.uk'));
  assert.ok(!isPlausibleEmail('sam@localhost'));
  assert.ok(!isPlausibleEmail('sam@gmail'));
  assert.ok(!isPlausibleEmail('sam@gmail..com'));
  assert.ok(!isPlausibleEmail('sam gmail.com'));
  assert.ok(!isPlausibleEmail('sam@gmail.c'));
});
