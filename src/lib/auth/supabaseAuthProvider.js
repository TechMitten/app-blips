import { supabase } from '../../supabase';
import { desktopBridge, isDesktop } from '../desktop';
import { markOAuthRedirect, consumeOAuthReturn } from '../config';

// Google and GitHub put the profile name in full_name / name / user_name.
const toUser = (user) => user ? {
  ...user,
  id: user.id,
  uid: user.id,
  displayName: user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || '',
  username: user.user_metadata?.username || '',
} : null;

// Latest signed-in user, so getPrimaryProviderId can answer synchronously.
let currentUser = null;

const throwIfError = ({ error }) => { if (error) throw error; };

const onAuthStateChanged = (callback) => {
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) console.error('Failed to restore auth session:', error);
    currentUser = data?.session?.user || null;
    callback(toUser(currentUser));
  });
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    callback(toUser(currentUser), event);
  });
  return () => data.subscription.unsubscribe();
};

// The confirm-signup and reset-password email templates link to our own
// domain (`/?token_hash=...&type=...`) instead of Supabase's /auth/v1/verify,
// because spam filters distrust mail whose links point at a different domain
// than its sender. Verified once per page load; resolves to the link type,
// or null when the URL carries no link.
let emailLinkResult = null;
const consumeEmailLink = () => {
  if (emailLinkResult) return emailLinkResult;
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (!tokenHash || !type) {
    emailLinkResult = Promise.resolve(null);
    return emailLinkResult;
  }
  params.delete('token_hash');
  params.delete('type');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  emailLinkResult = supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
    if (error) throw error;
    return type;
  });
  return emailLinkResult;
};

// A failed web OAuth sign-in comes back as `?error=...&error_description=...`
// (query or hash). Supabase only logs it, which looked like being bounced to
// the studio picker for no reason; consume it so the auth modal can say why.
// Returns a message, or null when the URL carries no OAuth error.
const OAUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description'];
const consumeOAuthError = () => {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const source = search.has('error') ? search : hash.has('error') ? hash : null;
  if (!source) return null;
  const description = source.get('error_description') || source.get('error');
  OAUTH_ERROR_PARAMS.forEach((key) => { search.delete(key); hash.delete(key); });
  const query = search.toString();
  const fragment = hash.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`);
  // The provider handed back verified emails that belong to more than one
  // existing account, so Supabase can't pick one to link the identity to.
  if (/multiple accounts with the same email/i.test(description)) {
    return 'The email addresses on that account match more than one AppBlips account, so we couldn\'t tell which one to sign in to. Sign in another way, or remove the extra email from that provider.';
  }
  return `Sign-in didn't complete: ${description}`;
};

const signIn = async (email, password) => throwIfError(await supabase.auth.signInWithPassword({ email, password }));

// Sign-up is OAuth only. On the web the page redirects to the provider and
// back (the session is picked up from the URL on load). The desktop window
// can't be redirected, so the provider page opens in the system browser and
// comes back to a loopback listener in the main process (electron/oauthLoopback.js).
const OAUTH_PROVIDERS = ['google', 'github'];
const signInWithOAuth = async (provider) => {
  if (!OAUTH_PROVIDERS.includes(provider)) throw new Error('Unsupported sign-in provider.');
  if (!isDesktop) {
    markOAuthRedirect();
    const result = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/` } });
    if (result.error) consumeOAuthReturn();
    throwIfError(result);
    return;
  }
  const { redirectUri } = await desktopBridge.auth.begin();
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectUri, skipBrowserRedirect: true },
    });
    if (error) throw error;
    const { code } = await desktopBridge.auth.open(data.url);
    throwIfError(await supabase.auth.exchangeCodeForSession(code));
  } catch (err) {
    desktopBridge.auth.cancel().catch(() => {});
    throw err;
  }
};
const cancelOAuth = () => (isDesktop ? desktopBridge.auth.cancel().catch(() => {}) : undefined);

const sendPasswordReset = async (email) => throwIfError(await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/`,
}));
const signOut = async () => throwIfError(await supabase.auth.signOut());
const updatePassword = async (password) => throwIfError(await supabase.auth.updateUser({ password }));
const updateProfile = async ({ displayName }) => throwIfError(await supabase.auth.updateUser({ data: { display_name: displayName } }));
const reauthenticate = async ({ password } = {}) => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw error || new Error('Sign in required.');
  // An account that only signs in with Google/GitHub has no password; the
  // live session that getUser just verified is the proof of identity.
  if (getPrimaryProviderId() !== 'password') return;
  if (!password) throw new Error('Enter your password to continue.');
  throwIfError(await supabase.auth.signInWithPassword({ email: user.email, password }));
};
// 'password' when the account can sign in with one, else its OAuth provider.
const getPrimaryProviderId = () => {
  if (!currentUser) return 'password';
  const providers = (currentUser.identities || []).map((identity) => identity.provider);
  if (providers.length === 0 || providers.includes('email')) return 'password';
  return providers[0];
};
const deleteAccount = async () => throwIfError(await supabase.rpc('delete_own_account'));
const getIdToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('Sign in required.');
  return data.session.access_token;
};

export default {
  onAuthStateChanged, consumeEmailLink, consumeOAuthError, signIn, signInWithOAuth, cancelOAuth, sendPasswordReset, signOut,
  updatePassword, updateProfile, deleteAccount, reauthenticate, getIdToken,
  getPrimaryProviderId,
};
