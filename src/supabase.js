import { createClient } from '@supabase/supabase-js';

export const supabaseEnabled = import.meta.env.SELF_HOSTED_MODE === 'false';

let supabase = null;

if (supabaseEnabled) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const missing = [!url && 'VITE_SUPABASE_URL', !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length) {
    throw new Error(`SELF_HOSTED_MODE is false but missing required env vars: ${missing.join(', ')}`);
  }
  supabase = createClient(url, publishableKey);
}

export { supabase };
