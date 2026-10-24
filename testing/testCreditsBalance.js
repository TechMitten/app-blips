// Balance math for AppBlips AI Credits: monthly order credits, trials and usage.
// Run: node --test testing/testCreditsBalance.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCreditsFromUsage,
  lookupPolarBalance,
  STARTER_PRODUCT_ID,
  TRIAL_PRODUCT_ID,
} from '../electron/server/creditsApi.js';

const BUILDER = '0da84082-4c8e-420a-8b6d-701010c906fa';
const STARTER_BENEFIT = '5b523124-e43c-4917-88cb-6d64625b829c';
const TRIAL_BENEFIT = '3ceded01-ad19-4ec0-a544-f97d7f66572f';
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

function mockFetch({
  grants = [],
  orders = [],
  used = 0,
  customers = [{ id: 'cust_1', email: 'a@b.com' }],
  grantPages = null,
  orderPages = null,
  customerStatus = 200,
  meterStatus = 200,
}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    if (parsed.pathname === '/v1/customers/') {
      return customerStatus === 200
        ? json({ items: customers })
        : new Response('forbidden', { status: customerStatus });
    }
    if (parsed.pathname === '/v1/benefit-grants') {
      const pages = grantPages || [grants];
      const page = Number(parsed.searchParams.get('page') || '1');
      return json({ items: pages[page - 1] || [], pagination: { max_page: pages.length } });
    }
    if (parsed.pathname === '/v1/orders/') {
      const pages = orderPages || [orders];
      const page = Number(parsed.searchParams.get('page') || '1');
      return json({ items: pages[page - 1] || [], pagination: { max_page: pages.length } });
    }
    if (parsed.pathname.includes('/quantities')) {
      return meterStatus === 200
        ? json({ total: used })
        : new Response('boom', { status: meterStatus });
    }
    throw new Error(`Unexpected Polar request: ${parsed.pathname}`);
  };
  return { calls, fetchImpl };
}

test('only the newest paid order counts, and usage starts at that order', async () => {
  const recent = daysAgo(2);
  const { calls, fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    orders: [
      { status: 'paid', total_amount: 2500, product_id: BUILDER, created_at: recent },
      { status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(40) },
    ],
    used: 250,
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.totalGranted, 2750);
  assert.equal(balance.totalUsed, 250);
  assert.equal(balance.remaining, 2500);

  const grantsCall = calls.find((call) => call.pathname === '/v1/benefit-grants');
  assert.equal(grantsCall.searchParams.get('customer_id'), 'cust_1');

  const quantitiesCall = calls.find((call) => call.pathname.includes('/quantities'));
  assert.equal(quantitiesCall.searchParams.get('start_timestamp'), new Date(Date.parse(recent)).toISOString());
  assert.equal(quantitiesCall.searchParams.get('interval'), 'month');
});

test('credits stop counting once the newest paid order is over a billing period old', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    orders: [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(40) }],
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, false);
  assert.equal(balance.totalGranted, 0);
});

test('an active trial grants its 100 credits', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: TRIAL_BENEFIT, granted_at: daysAgo(1), customer: { email: 'a@b.com' } }],
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.totalGranted, 100);
  assert.equal(balance.trialActive, true);
  assert.equal(balance.hasTrial, true);
});

test('a revoked trial reads as expired and blocks a second trial', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: TRIAL_BENEFIT, granted_at: daysAgo(1), is_revoked: true, customer: { email: 'a@b.com' } }],
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.trialExpired, true);
  assert.equal(balance.hasTrial, true);
  assert.equal(balance.remaining, 0);
});

test('falls back to benefit grants when orders cannot be read', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
  });
  const withoutOrders = async (url) => {
    if (new URL(url).pathname === '/v1/orders/') return new Response('forbidden', { status: 403 });
    return fetchImpl(url);
  };

  const warn = console.warn;
  console.warn = () => {};
  let balance;
  try {
    balance = await lookupPolarBalance('token', { email: 'a@b.com' }, withoutOrders);
  } finally {
    console.warn = warn;
  }

  assert.equal(balance.found, true);
  assert.equal(balance.totalGranted, 1000);
});

test('ignores $0 trial orders and refunded orders when picking the current month', async () => {
  const current = daysAgo(10);
  const { calls, fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    orders: [
      { status: 'paid', total_amount: 0, product_id: TRIAL_PRODUCT_ID, created_at: daysAgo(70) },
      { status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(40) },
      { status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: current },
      { status: 'refunded', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(1) },
    ],
    used: 300,
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.totalGranted, 1000);
  assert.equal(balance.remaining, 700);
  const quantitiesCall = calls.find((call) => call.pathname.includes('/quantities'));
  assert.equal(quantitiesCall.searchParams.get('start_timestamp'), new Date(Date.parse(current)).toISOString());
});

test('a revoked trial still lets an active paid plan count, and reads as expired', async () => {
  const { fetchImpl } = mockFetch({
    grants: [
      { customer_id: 'cust_1', benefit_id: TRIAL_BENEFIT, is_revoked: true, customer: { email: 'a@b.com' } },
      { customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } },
    ],
    orders: [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(5) }],
    used: 100,
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.totalGranted, 1000);
  assert.equal(balance.remaining, 900);
  assert.equal(balance.trialExpired, true);
  assert.equal(balance.trialActive, false);
  assert.equal(balance.hasTrial, true);
});

test('an expired trial with no plan is found and marked expired', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: TRIAL_BENEFIT, granted_at: daysAgo(5), customer: { email: 'a@b.com' } }],
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.trialExpired, true);
  assert.equal(balance.totalGranted, 0);
  assert.equal(balance.remaining, 0);
});

test('usage above the grant clamps remaining at zero but still reports the usage', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    orders: [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(5) }],
    used: 1500,
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.totalUsed, 1500);
  assert.equal(balance.remaining, 0);
});

test('a failed meter read leaves usage at zero instead of failing the lookup', async () => {
  const { fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    orders: [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(5) }],
    meterStatus: 500,
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.totalUsed, 0);
  assert.equal(balance.remaining, 1000);
});

test('follows grant and order pagination', async () => {
  const current = daysAgo(5);
  const { fetchImpl } = mockFetch({
    grantPages: [
      [{ customer_id: 'someone_else', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'other@b.com' } }],
      [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    ],
    orderPages: [
      [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(40) }],
      [{ status: 'paid', total_amount: 2500, product_id: BUILDER, created_at: current }],
    ],
    used: 250,
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.totalGranted, 2750);
  assert.equal(balance.remaining, 2500);
});

test('falls back to the unfiltered grant list when the customer search is forbidden', async () => {
  const { calls, fetchImpl } = mockFetch({
    customerStatus: 403,
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 500 }, customer: { email: 'a@b.com' } }],
  });

  const balance = await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.remaining, 500);
  const grantsCall = calls.find((call) => call.pathname === '/v1/benefit-grants');
  assert.equal(grantsCall.searchParams.get('customer_id'), null);
});

test('a customer id from a signed-in token skips the customer search', async () => {
  const { calls, fetchImpl } = mockFetch({
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 } }],
    orders: [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(5) }],
    used: 100,
  });

  const balance = await lookupPolarBalance('token', { customerId: 'cust_1' }, fetchImpl);

  assert.equal(balance.found, true);
  assert.equal(balance.remaining, 900);
  assert.ok(!calls.some((call) => call.pathname === '/v1/customers/'));
});

test('ignores near-match customers and requires the exact email', async () => {
  const { calls, fetchImpl } = mockFetch({
    customers: [
      { id: 'cus_other', email: 'a@b.com.attacker.example' },
      { id: 'cust_1', email: 'a@b.com' },
    ],
    grants: [{ customer_id: 'cust_1', benefit_id: STARTER_BENEFIT, properties: { units: 1000 }, customer: { email: 'a@b.com' } }],
    orders: [{ status: 'paid', total_amount: 1000, product_id: STARTER_PRODUCT_ID, created_at: daysAgo(5) }],
  });

  await lookupPolarBalance('token', { email: 'a@b.com' }, fetchImpl);

  const grantsCall = calls.find((call) => call.pathname === '/v1/benefit-grants');
  assert.equal(grantsCall.searchParams.get('customer_id'), 'cust_1');
});

test('converts token usage into credits with a one-credit minimum', () => {
  assert.equal(calculateCreditsFromUsage(), 1);
  assert.equal(calculateCreditsFromUsage({ prompt_tokens: 1000, completion_tokens: 0 }), 1);
  assert.equal(calculateCreditsFromUsage({ prompt_tokens: 0, completion_tokens: 2000 }), 2);
  assert.equal(calculateCreditsFromUsage({ prompt_tokens: 9000, completion_tokens: 1000 }), 3);
});
