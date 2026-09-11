const configuredMode = String(import.meta.env.APPBLIPS_GENERATED_AI_MODE || 'byok').trim().toLowerCase();

// Hosted builds always use the platform relay. Self-hosted operators can
// explicitly choose BYOK (the safe default) or their own server relay.
export const generatedAiMode = import.meta.env.SELF_HOSTED_MODE === 'false'
  ? 'hosted'
  : (configuredMode === 'relay' ? 'relay' : 'byok');

// This URL is intentionally public configuration. Provider credentials must
// remain in APPBLIPS_APP_LLM_* server-side variables.
export const generatedAiRelayUrl = String(import.meta.env.APPBLIPS_APP_AI_RELAY_URL || '').trim();
