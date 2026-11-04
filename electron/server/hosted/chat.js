// Gate for hosted /api/chat: authenticate the Clerk session, resolve the
// user's plan, apply that plan's model alias, and debit one build credit for
// paid tiers before the provider is called (refunded if the call fails).
//
// Build vs. non-build: the client marks Ask-mode requests with `ask: true`
// and error-repair requests with `auto_fix: true`; those are free. Every
// other request creates a version and costs one credit.

import { randomUUID } from 'node:crypto';
import { PLANS, isPlanId, planModel } from './plans.js';
import { verifyClerkToken } from './clerk.js';
import { findCreditAccount, debitCredits, creditCredits } from './creem.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const planOf = (account) => (account?.plan && isPlanId(account.plan) ? account.plan : 'basic');

// A light per-user ceiling so "unlimited" during the beta still has a floor.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_BUILDS_PER_WINDOW = 60;
const buildWindows = new Map();

function allowBuild(userId) {
  const now = Date.now();
  const recent = (buildWindows.get(userId) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_BUILDS_PER_WINDOW) return false;
  recent.push(now);
  buildWindows.set(userId, recent);
  return true;
}

export async function gateChat(request, env, store) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { response: json(401, { error: 'Sign in to continue.' }) };

  let userId;
  try {
    userId = (await verifyClerkToken(token, env)).sub;
  } catch {
    return { response: json(401, { error: 'Your session has expired. Sign in again.' }) };
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { response: json(400, { error: 'Invalid JSON body.' }) };
  }

  // Client-supplied overrides never win: the plan decides the model, and
  // hosted chat always spends the server's provider, not the user's key.
  delete payload.hosted_model_override;
  delete payload.user_provider;

  const account = store.getAccount(userId);
  // A subscription is required for any AI access -- including the free
  // beta's Basic plan, which is $1/month.
  if (!account?.active) {
    return {
      response: json(402, {
        error: 'A subscription is required to use AppBlips AI. Choose a plan to start building.',
        code: 'subscription_required',
      }),
    };
  }
  const planId = planOf(account);
  const plan = PLANS[planId];
  const model = planModel(env, planId);
  if (model) payload.hosted_model_override = model;

  const isBuild = payload.ask !== true && payload.auto_fix !== true;
  let charge = null;

  if (isBuild) {
    if (!allowBuild(userId)) {
      return { response: json(429, { error: 'You are building very quickly. Please wait a moment and try again.' }) };
    }
    if (plan.monthlyCredits != null) {
      if (!account?.creem_customer_id) {
        return { response: json(402, { error: 'Your plan is not linked to a payment account yet.' }) };
      }
      let walletId = account.credit_account_id;
      if (!walletId) {
        const wallet = await findCreditAccount(env, account.creem_customer_id).catch(() => null);
        if (!wallet) return { response: json(402, { error: 'Your credit wallet is not ready yet.' }) };
        walletId = wallet.id;
        store.saveAccount({ userId, customerId: account.creem_customer_id, creditAccountId: walletId, plan: planId });
      }

      const reference = `build_${randomUUID()}`;
      const result = await debitCredits(env, walletId, { amount: 1, reference, idempotencyKey: reference }).catch(() => null);
      if (!result?.ok) {
        const insufficient = result?.status === 402 || /insufficient|balance|exceed/i.test(result?.text || '');
        return {
          response: json(402, {
            error: insufficient
              ? 'You are out of build credits. Upgrade your plan to keep building.'
              : 'Could not reserve a build credit. Please try again.',
            code: insufficient ? 'credits_exhausted' : 'credit_error',
          }),
        };
      }
      charge = { accountId: walletId, amount: 1, reference };
    }
  }

  const gated = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { request: gated, userId, planId, charge };
}

// Gives a build credit back when the provider rejects the request outright.
export async function refundBuildCredit(env, charge) {
  if (!charge) return;
  await creditCredits(env, charge.accountId, {
    amount: charge.amount,
    reference: `${charge.reference}_refund`,
    idempotencyKey: `${charge.reference}_refund`,
  }).catch(() => {});
}
