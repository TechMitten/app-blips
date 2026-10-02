import { createClient } from '@supabase/supabase-js';
import { isDesktop } from './lib/desktop';

// Multi-user features (Supabase sign-in, cloud projects, deploys, the gallery)
// turn on when an operator configures their own Supabase project. The URL and
// publishable key are public and safe to ship in the browser; they are no
// longer defaulted to any particular project.
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseEnabled = Boolean(url && publishableKey);

let supabase = null;

if (supabaseEnabled) {
  // The desktop app signs in with Google/GitHub through the system browser, so
  // the code returned there has to be exchanged with a PKCE verifier kept in
  // this window (see signInWithOAuth in lib/auth/supabaseAuthProvider.js).
  supabase = createClient(url, publishableKey, isDesktop ? { auth: { flowType: 'pkce' } } : undefined);
}

export { supabase };
