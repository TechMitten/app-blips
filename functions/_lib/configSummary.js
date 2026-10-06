// Human-readable summary of the server configuration, printed once at startup
// (Vite dev server and the Docker server) so a misconfiguration shows up as an
// actionable line in the terminal instead of a failed first request.
//
// Never includes secret values: only provider names, models, endpoints and the
// names of variables that still need filling in.
import { resolveProvider, renamedLlmVars, LLM_ENV } from './providers.js';
import { supabaseConfigured } from './supabaseServer.js';

const describeProvider = (provider) => `${provider.label} · ${provider.model} · ${provider.baseUrl}`;

// Returns [{ level: 'info' | 'warn' | 'error', label?, text }].
export const describeConfig = (env) => {
  const lines = [];
  const multiUser = supabaseConfigured(env);
  lines.push({
    level: 'info',
    label: 'Mode',
    text: multiUser ? 'multi-user (Supabase sign-in, deploys)' : 'single-user (local)',
  });

  const builder = resolveProvider(env, 'APPBLIPS_LLM', { quiet: true });
  if (builder.unconfigured && !multiUser) {
    // A single-user instance can run without one: users can pick a provider in the app.
    lines.push({ level: 'warn', label: 'Builder AI', text: 'No provider in .env. Set one there, or pick one in the app under Settings → AI.' });
  } else if (builder.error) {
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
      text: `Several provider keys are set (${[builder.id, ...builder.alsoConfigured].join(', ')}); using ${builder.id}. Set ${LLM_ENV.PROVIDER} to choose.`,
    });
  }

  const renamed = renamedLlmVars(env);
  if (renamed.length) {
    lines.push({
      level: 'warn',
      text: `Renamed (old names still work for now): ${renamed.map(({ from, to }) => `${from} -> ${to}`).join(', ')}.`,
    });
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
