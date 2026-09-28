const DEFAULT_URL = 'https://kiejevuedddhtgyqrntp.supabase.co';

export const supabaseUrl = (env = {}) => String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_URL).replace(/\/$/, '');
export const supabasePublishableKey = (env = {}) => env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const supabaseServiceKey = (env = {}) => env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseHeaders = (env, { service = false, token } = {}) => {
  const key = service ? supabaseServiceKey(env) : supabasePublishableKey(env);
  return {
    apikey: key,
    authorization: `Bearer ${token || key}`,
    'content-type': 'application/json',
  };
};
