// Human-readable summary of the server configuration, printed once at startup
// (Vite dev server and the Docker server) so a misconfiguration shows up as an
// actionable line in the terminal instead of a failed first request.
//
// Never includes secret values: only provider names, models, endpoints and the
// names of variables that still need filling in.
import { resolveProvider, ignoredAppProviderVars, renamedAppAiLimits } from './providers.js';

const FIREBASE_CLIENT_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const filled = (env, name) => String(env?.[name] ?? '').trim() !== '';

const describeProvider = (provider) => `${provider.label} · ${provider.model} · ${provider.baseUrl}`;

// Returns [{ level: 'info' | 'warn' | 'error', label?, text }].
export const describeConfig = (env) => {
  const lines = [];
  const hosted = env?.SELF_HOSTED_MODE === 'false';
  lines.push({
    level: 'info',
    label: 'Mode',
    text: hosted ? 'hosted (Firebase sign-in, deploys)' : 'self-hosted (single local user)',
  });

  const builder = resolveProvider(env, 'APPBLIPS_LLM', { quiet: true });
  if (builder.error) {
    lines.push({ level: 'error', label: 'Builder AI', text: builder.error });
  } else if (builder.missing.length) {
    lines.push({
      level: 'error',
      label: 'Builder AI',
      text: `${builder.label} is selected but ${builder.missing.join(', ')} ${builder.missing.length > 1 ? 'are' : 'is'} empty. Add ${builder.missing.length > 1 ? 'them' : 'it'} to your .env.`,
    });
  } else {
    lines.push({ level: 'info', label: 'Builder AI', text: describeProvider(builder) });
  }
  if (!builder.error && builder.alsoConfigured?.length) {
    lines.push({
      level: 'warn',
      text: `Several provider keys are set (${[builder.id, ...builder.alsoConfigured].join(', ')}); using ${builder.id}. Set APPBLIPS_LLM_PROVIDER to choose.`,
    });
  }

  const configuredMode = String(env?.APPBLIPS_GENERATED_AI_MODE || 'relay').trim().toLowerCase();
  if (!hosted && configuredMode === 'byok') {
    lines.push({ level: 'info', label: 'App AI', text: 'BYOK, as configured (people using a finished app enter their own key)' });
  } else if (!builder.error && !builder.missing.length) {
    const where = hosted ? 'deployed apps' : 'relay';
    lines.push({ level: 'info', label: 'App AI', text: `${where}, sharing the builder's provider · ${builder.model}` });
  }
  const renamed = renamedAppAiLimits(env);
  if (renamed.length) {
    lines.push({
      level: 'warn',
      text: `Renamed (old names still work for now): ${renamed.map(({ from, to }) => `${from} -> ${to}`).join(', ')}.`,
    });
  }
  const ignored = ignoredAppProviderVars(env);
  if (ignored.length) {
    lines.push({
      level: 'warn',
      text: `${ignored.join(', ')} ${ignored.length > 1 ? 'are' : 'is'} no longer used: AI in generated apps always shares the builder's provider and key. Remove ${ignored.length > 1 ? 'them' : 'it'}.`,
    });
  }

  if (hosted) {
    const missing = [...FIREBASE_CLIENT_VARS, 'FIREBASE_API_KEY'].filter((name) => !filled(env, name));
    if (missing.length) {
      lines.push({
        level: 'error',
        label: 'Firebase',
        text: `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} empty. See .env.hosted.example.`,
      });
    }
  }
  return lines;
};

// Plain-text block for the terminal.
export const formatConfigSummary = (lines) => {
  const mark = { info: ' ', warn: '!', error: 'x' };
  const body = lines.map(({ level, label, text }) => {
    const head = label ? `${label} ${'.'.repeat(Math.max(2, 12 - label.length))} ` : '';
    return `  ${mark[level]} ${head}${text}`;
  });
  return ['AppBlips configuration', ...body].join('\n');
};
