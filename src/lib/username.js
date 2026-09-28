import { supabase } from '../supabase';

// Deploy slugs are `username/app-slug` and functions/[[path]].js's
// SLUG_PATTERN caps the first segment at 39 chars of [a-z0-9-], so this stays
// in lockstep with that.
export const USERNAME_REGEX = /^[a-z0-9-]{3,39}$/;

export const normalizeUsername = (raw) => (raw || '').trim().toLowerCase();

export const USERNAME_FORMAT_HINT =
  'Username must be 3-39 characters and can only contain lowercase letters, numbers, and hyphens.';

export const fetchUsername = async (uid) => {
  const { data, error } = await supabase.from('profiles').select('username').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data?.username || '';
};

// Atomically reserves `usernames/{username}` and stamps it onto `users/{uid}`.
// Supabase rules deny any further write to either document once created, so
// a successful claim here is permanent -- see Supabase RLS.
export const claimUsername = async (uid, rawUsername) => {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error('Username cannot be empty.');
  if (!USERNAME_REGEX.test(username)) throw new Error(USERNAME_FORMAT_HINT);

  const { data, error } = await supabase.rpc('claim_username', { requested_username: username });
  if (error) throw error;
  return data;
};

// Account deletion: removes the profile doc. The `usernames/{username}` claim
// is deliberately left in place -- rules forbid deleting it, which keeps a
// departed user's name from being taken over by someone else.
export const deleteUserProfile = async () => {};
