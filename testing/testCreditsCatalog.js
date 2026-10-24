// Catalog invariants, a cross-check against the landing project, and an
// opt-in live check of the Polar products.
// Run: node --test testing/testCreditsCatalog.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CREDIT_PACKS,
  FREE_TRIAL_PACK,
  STARTER_PRODUCT_ID,
  TRIAL_PRODUCT_ID,
} from '../electron/server/creditsApi.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const landingDir = process.env.APPBLIPS_LANDING_DIR
  ? resolve(process.env.APPBLIPS_LANDING_DIR)
  : resolve(repoRoot, '../AppBlips-Landing');
const landingCredits = join(landingDir, 'shared/credits.ts');
const landingAvailable = existsSync(landingCredits);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('credit packs are distinct monthly plans with the current prices', () => {
  assert.deepEqual(CREDIT_PACKS.map((pack) => pack.id), ['starter', 'builder', 'studio']);

  const ids = new Set([FREE_TRIAL_PACK.id]);
  const productIds = new Set([FREE_TRIAL_PACK.productId]);

  for (const pack of CREDIT_PACKS) {
    assert.ok(!ids.has(pack.id), `duplicate pack id: ${pack.id}`);
    ids.add(pack.id);

    assert.match(pack.productId, UUID, `${pack.id} has a malformed Polar product id`);
    assert.ok(!productIds.has(pack.productId), `duplicate product id: ${pack.productId}`);
    productIds.add(pack.productId);

    assert.ok(pack.name.includes('a month'), `${pack.id} should be priced per month`);
    assert.ok(pack.priceUsd > 0, `${pack.id} should cost something`);
    assert.ok(pack.credits > 0, `${pack.id} should grant credits`);
    assert.ok(pack.bonusCredits >= 0 && pack.bonusCredits < pack.credits, `${pack.id} bonus looks wrong`);
  }

  assert.equal(FREE_TRIAL_PACK.isTrial, true);
  assert.equal(FREE_TRIAL_PACK.priceUsd, 0);
  assert.ok(FREE_TRIAL_PACK.description.includes('Starter plan'));
  assert.match(CREDIT_PACKS[0].description, /reset each month/);
  assert.match(CREDIT_PACKS[0].description, /do not roll over/);
  assert.ok(productIds.has(STARTER_PRODUCT_ID));
  assert.ok(productIds.has(TRIAL_PRODUCT_ID));
});

test(
  'catalog matches the landing project',
  { skip: landingAvailable ? false : `no landing checkout at ${landingCredits}` },
  () => {
    const source = readFileSync(landingCredits, 'utf8');
    const hasNumber = (key, value) => new RegExp(`\\b${key}: ${value}\\b`).test(source);

    assert.ok(source.includes(`TRIAL_PRODUCT_ID = '${TRIAL_PRODUCT_ID}'`), 'trial product id drifted');
    assert.ok(source.includes(`STARTER_PRODUCT_ID = '${STARTER_PRODUCT_ID}'`), 'starter product id drifted');

    for (const pack of CREDIT_PACKS) {
      assert.ok(source.includes(`id: '${pack.id}'`), `pack id drifted: ${pack.id}`);
      assert.ok(source.includes(`name: '${pack.name}'`), `pack name drifted: ${pack.id}`);
      assert.ok(source.includes(`shortName: '${pack.shortName}'`), `pack short name drifted: ${pack.id}`);
      assert.ok(source.includes(`'${pack.productId}'`), `product id drifted: ${pack.id}`);
      assert.ok(hasNumber('priceUsd', pack.priceUsd), `price drifted: ${pack.id}`);
      assert.ok(hasNumber('credits', pack.credits), `credits drifted: ${pack.id}`);
    }

    assert.ok(source.includes(`name: '${FREE_TRIAL_PACK.name}'`), 'trial name drifted');
    assert.ok(source.includes(`shortName: '${FREE_TRIAL_PACK.shortName}'`), 'trial short name drifted');
  },
);

const liveToken = String(process.env.POLAR_TOKEN || '').trim();
const liveEnabled = Boolean(liveToken) && process.env.APPBLIPS_POLAR_CONTRACT === '1';
const LIVE_SKIP = 'set POLAR_TOKEN (a test-mode token) and APPBLIPS_POLAR_CONTRACT=1';

const fetchProduct = async (productId) => {
  const res = await fetch(`https://api.polar.sh/v1/products/${productId}`, {
    headers: { Authorization: `Bearer ${liveToken}`, Accept: 'application/json' },
  });
  assert.equal(res.status, 200, `Polar product ${productId} returned HTTP ${res.status}`);
  return res.json();
};

test('live Polar products are unarchived monthly plans at the listed prices', { skip: liveEnabled ? false : LIVE_SKIP }, async () => {
  for (const pack of CREDIT_PACKS) {
    const product = await fetchProduct(pack.productId);
    assert.equal(product.is_recurring, true, `${pack.id} must be a subscription in Polar`);
    assert.equal(product.is_archived, false, `${pack.id} must not be archived in Polar`);
    assert.equal(product.recurring_interval, 'month', `${pack.id} must renew monthly in Polar`);
    const prices = (product.prices || []).filter((price) => !price.is_archived);
    assert.ok(
      prices.some((price) => price.price_amount === pack.priceUsd * 100),
      `${pack.id} should cost ${pack.priceUsd * 100} cents in Polar`,
    );
  }

  const trial = await fetchProduct(FREE_TRIAL_PACK.productId);
  assert.equal(trial.is_recurring, true, 'the trial must be a subscription in Polar');
  assert.equal(trial.is_archived, false, 'the trial must not be archived in Polar');
  assert.equal(trial.trial_interval, 'day', 'the trial should be measured in days');
  assert.equal(trial.trial_interval_count, 3, 'the trial should last 3 days');
});
