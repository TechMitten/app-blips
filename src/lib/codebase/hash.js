// Content hashes for the codebase blob store. Web Crypto exists in the
// renderer and in Node, so tests and the app share this.
const encoder = new TextEncoder();

export function toBytes(content) {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

export async function sha256Hex(content) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toBytes(content));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
