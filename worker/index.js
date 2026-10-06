// Cloudflare Worker entry — serves the same handlers the Cloudflare Pages
// Functions used to (functions/), so the LLM proxy keeps working
// without a Pages site. The handlers are written with Fetch primitives only,
// so they run unchanged on Workers.
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { handleAnalyticsWebsiteCreate, handleAnalyticsStats } from '../functions/_lib/umamiProxy.js';
import { handleBillingStatus, handleBillingCheckout, handleBillingPortal, handleBillingEndTrial, handleStripeWebhook } from '../functions/_lib/billing.js';
import { handleDeployUpload, handleDeployDelete } from '../functions/_lib/deploys.js';
import { handleAccountDelete } from '../functions/_lib/account.js';

const methodNotAllowed = () => new Response('Method not allowed', { status: 405 });
const notFound = () => new Response('Not found', { status: 404 });

export default {
  async fetch(request, env, ctx) {
    const waitUntil = (promise) => ctx.waitUntil(promise);
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/api/chat':
        return request.method === 'POST' ? handleChatProxy(request, env, waitUntil) : methodNotAllowed();
      case '/api/analytics/website':
        return request.method === 'POST' ? handleAnalyticsWebsiteCreate(request, env) : methodNotAllowed();
      case '/api/analytics/stats':
        return request.method === 'GET' ? handleAnalyticsStats(request, env) : methodNotAllowed();
      case '/api/billing/status':
        return request.method === 'GET' ? handleBillingStatus(request, env) : methodNotAllowed();
      case '/api/billing/checkout':
        return request.method === 'POST' ? handleBillingCheckout(request, env) : methodNotAllowed();
      case '/api/billing/portal':
        return request.method === 'POST' ? handleBillingPortal(request, env) : methodNotAllowed();
      case '/api/billing/end-trial':
        return request.method === 'POST' ? handleBillingEndTrial(request, env) : methodNotAllowed();
      case '/api/billing/webhook':
        return request.method === 'POST' ? handleStripeWebhook(request, env) : methodNotAllowed();
      case '/api/deploys':
        if (request.method === 'POST') return handleDeployUpload(request, env);
        return request.method === 'DELETE' ? handleDeployDelete(request, env) : methodNotAllowed();
      case '/api/account/delete':
        return request.method === 'POST' ? handleAccountDelete(request, env) : methodNotAllowed();
      default:
        return notFound();
    }
  },
};
