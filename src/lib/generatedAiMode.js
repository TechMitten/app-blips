const configuredMode = String(import.meta.env.APPBLIPS_GENERATED_AI_MODE || 'relay').trim().toLowerCase();

// Apps use the same AI provider as the builder in every mode: hosted builds go
// through the platform relay, and self-hosted ones through the server's own
// relay. Self-hosted operators can opt into BYOK instead, where each person
// using a finished app enters their own key.
export const generatedAiMode = import.meta.env.SELF_HOSTED_MODE === 'false'
  ? 'hosted'
  : (configuredMode === 'byok' ? 'byok' : 'relay');

// This URL is intentionally public configuration. Provider credentials must
// remain in server-side variables (the builder's APPBLIPS_* provider block).
export const generatedAiRelayUrl = String(import.meta.env.APPBLIPS_APP_AI_RELAY_URL || '/api/app-ai/chat').trim();

// The generated app's AI calls go through the parent page in the preview
// (hosted, and self-hosted relay) rather than from the sandboxed frame itself.
export const previewAiViaParent = generatedAiMode !== 'byok';

// The relay URL resolved against this AppBlips' origin, for HTML that leaves
// the app (new tab, export).
export const absoluteRelayUrl = () => {
  try { return new URL(generatedAiRelayUrl, window.location.href).href; } catch { return generatedAiRelayUrl; }
};
