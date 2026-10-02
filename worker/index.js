// Cloudflare Worker entry — serves the same handlers the Cloudflare Pages
// Functions used to (functions/), so the LLM proxy and AI relays keep working
// without a Pages site. The handlers are written with Fetch primitives only,
// so they run unchanged on Workers.
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { handleSelfHostedAiChat } from '../functions/_lib/selfHostedAiRelay.js';
import { handleAiChat, handleAiSession } from '../functions/_lib/aiRelay.js';
import { handleDebugUnlock } from '../functions/_lib/debugUnlock.js';
import { handleAnalyticsWebsiteCreate, handleAnalyticsStats } from '../functions/_lib/umamiProxy.js';

const methodNotAllowed = () => new Response('Method not allowed', { status: 405 });
const notFound = () => new Response('Not found', { status: 404 });

export default {
  async fetch(request, env, ctx) {
    const waitUntil = (promise) => ctx.waitUntil(promise);
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/api/chat':
        return request.method === 'POST' ? handleChatProxy(request, env, waitUntil) : methodNotAllowed();
      case '/api/app-ai/chat':
        return handleSelfHostedAiChat(request, env);
      case '/ai/chat':
        return request.method === 'POST' ? handleAiChat(request, env, waitUntil) : methodNotAllowed();
      case '/ai/session':
        return request.method === 'POST' ? handleAiSession(request, env) : methodNotAllowed();
      case '/api/debug-unlock':
        return request.method === 'POST' ? handleDebugUnlock(request, env) : methodNotAllowed();
      case '/api/analytics/website':
        return request.method === 'POST' ? handleAnalyticsWebsiteCreate(request, env) : methodNotAllowed();
      case '/api/analytics/stats':
        return request.method === 'GET' ? handleAnalyticsStats(request, env) : methodNotAllowed();
      default:
        return notFound();
    }
  },
};
