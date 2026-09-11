// Best-effort, per-isolate token buckets. Cloudflare may run many isolates, so
// this is deliberately structured behind a tiny interface that can later be
// replaced by a KV or Durable Object implementation without changing callers.
const buckets = new Map();

export const consumeToken = (key, { max = 20, windowSeconds = 60 } = {}) => {
  const capacity = Math.max(1, Number(max) || 20);
  const windowMs = Math.max(1, Number(windowSeconds) || 60) * 1000;
  const now = Date.now();
  const refillPerMs = capacity / windowMs;
  const previous = buckets.get(key) || { tokens: capacity, updatedAt: now };
  const tokens = Math.min(capacity, previous.tokens + ((now - previous.updatedAt) * refillPerMs));

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > 2000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.updatedAt > windowMs * 2) buckets.delete(bucketKey);
    }
  }
  return { allowed: true, retryAfter: 0 };
};

export const clearRateLimitsForTesting = () => buckets.clear();
