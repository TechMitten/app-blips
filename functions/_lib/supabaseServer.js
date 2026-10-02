export const supabaseUrl = (env = {}) => String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const supabasePublishableKey = (env = {}) =>
  env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const supabaseServiceKey = (env = {}) => env.SUPABASE_SERVICE_ROLE_KEY || '';

// True when the operator has configured a Supabase project. This is the
// server-side counterpart of `supabaseEnabled` in src/supabase.js: multi-user
// features (auth, cloud projects, deploys, the authenticated relay) turn on
// only when both the URL and publishable key are present. Without Supabase,
// AppBlips is a single local user with no sign-in and no cloud backend.
export const supabaseConfigured = (env = {}) => Boolean(supabaseUrl(env) && supabasePublishableKey(env));

export const supabaseHeaders = (env, { service = false, token } = {}) => {
  const key = service ? supabaseServiceKey(env) : supabasePublishableKey(env);
  return {
    apikey: key,
    authorization: `Bearer ${token || key}`,
    'content-type': 'application/json',
  };
};
