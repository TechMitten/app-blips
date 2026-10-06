const configuredMode = String(import.meta.env.APPBLIPS_GENERATED_AI_MODE || 'relay').trim().toLowerCase();

// Apps use the same AI provider as the builder: they go through the server's
// own relay by default. Operators can opt into BYOK instead, where each person
// using a finished app enters their own key, or switch AI inside apps off
// entirely ('off': no AI mode in the composer, no AI in previews, exports or
// deploys, and the server relays refuse -- see appAiDisabled in providers.js).
export const generatedAiMode = ['byok', 'off'].includes(configuredMode) ? configuredMode : 'relay';

// This URL is intentionally public configuration. Provider credentials must
// remain in server-side variables (the builder's APPBLIPS_* provider block).
export const generatedAiRelayUrl = String(import.meta.env.APPBLIPS_APP_AI_RELAY_URL || '/api/app-ai/chat').trim();

// The generated app's AI calls go through the parent page in the preview
// (relay mode) rather than from the sandboxed frame itself.
export const previewAiViaParent = generatedAiMode !== 'byok';

// The relay URL resolved against this AppBlips' origin, for HTML that leaves
// the app (new tab, export).
export const absoluteRelayUrl = () => {
  try { return new URL(generatedAiRelayUrl, window.location.href).href; } catch { return generatedAiRelayUrl; }
};
