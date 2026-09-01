// Supabase client for AppBlips.
//
// The project URL and publishable key are public by design — they only let the
// browser reach the Supabase API. Actual data access is locked down by
// row-level security (RLS) policies on the `projects` table, which scope every
// row to `auth.uid()`. The key is never injected into the generated preview
// iframe: `injectPreviewBridge` splices only the bridge script, so generated
// apps cannot read it.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nmmrhagtkfjqljktcwkf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bX8jWhkPlVD0bHx7cQ8RJg_mGjOdWc3';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
