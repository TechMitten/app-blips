import { createClient } from '@supabase/supabase-js';

export const supabaseEnabled = import.meta.env.SELF_HOSTED_MODE === 'false';
const DEFAULT_SUPABASE_URL = 'https://kiejevuedddhtgyqrntp.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_FcZ5iv2W-IVzAQnmMjxlnA_w72Y5t_a';

let supabase = null;

if (supabaseEnabled) {
  // These identify the hosted project's public API and are safe to ship in the
  // browser. Environment values remain optional overrides for another project.
  const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  supabase = createClient(url, publishableKey);
}

export { supabase };
