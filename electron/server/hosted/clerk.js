// Clerk session-token verification for the hosted server.
//
// Tokens are RS256 JWTs. The verification keys come from the instance's
// public JWKS, and the instance URL is derived from the publishable key
// (pk_test_/pk_live_ + base64 of "<frontend-api-host>$"), so no Clerk secret
// key is required just to validate sessions. The server only reads the
// publishable key, which is public by design.

import { createPublicKey, verify as verifySignature } from 'node:crypto';

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map(); // issuer -> { keys, fetchedAt }

const decodePart = (part) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

// https://<frontend-api-host> from a Clerk publishable key, or null.
export function clerkIssuer(env) {
  const key = String(env?.VITE_CLERK_PUBLISHABLE_KEY || env?.CLERK_PUBLISHABLE_KEY || '').trim();
  const match = /^pk_(?:test|live)_(.+)$/.exec(key);
  if (!match) return null;
  try {
    const host = Buffer.from(match[1], 'base64').toString('utf8').replace(/\$+$/, '');
    return host ? `https://${host}` : null;
  } catch {
    return null;
  }
}

async function getKeys(issuer) {
  const cached = jwksCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`Could not load Clerk signing keys (${res.status}).`);
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  jwksCache.set(issuer, { keys, fetchedAt: Date.now() });
  return keys;
}

// Returns the token's claims (with `sub` = Clerk user id), or throws.
export async function verifyClerkToken(token, env) {
  const issuer = clerkIssuer(env);
  if (!issuer) throw new Error('Clerk is not configured on this server.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed session token.');

  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Unsupported session token algorithm.');

  const keys = await getKeys(issuer);
  const jwk = keys.find((key) => key.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error('Unknown session token signing key.');

  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!verifySignature('sha256', signed, key, signature)) throw new Error('Invalid session token signature.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('Session token has expired.');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 5) throw new Error('Session token is not valid yet.');
  if (claims.iss !== issuer) throw new Error('Unexpected session token issuer.');
  if (!claims.sub) throw new Error('Session token has no user.');

  return claims;
}

// Deletes a Clerk user with the Backend API (Settings → Account → Delete
// account). Needs CLERK_SECRET_KEY, which the AppBlips Worker has; without
// it this returns { deleted: false } and the app deletes the user itself
// through Clerk's Frontend API.
export async function deleteClerkUser(env, userId) {
  const secret = String(env?.CLERK_SECRET_KEY || '').trim();
  if (!secret) return { deleted: false };
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${secret}` },
  });
  // Already gone counts as deleted.
  if (!res.ok && res.status !== 404) throw new Error(`Clerk refused to delete the user (${res.status}).`);
  return { deleted: true };
}

// Whether the session proved who it is (password, email code, Google…)
// within the last `maxMinutes`, from the token's "fva" claim
// ([first factor age, second factor age] in minutes, -1 = never). Clerk's
// own check treats a missing claim as a failure, and so does this.
export function verifiedRecently(claims, maxMinutes = 10) {
  const age = Array.isArray(claims?.fva) ? claims.fva[0] : null;
  return Number.isInteger(age) && age >= 0 && age <= maxMinutes;
}
