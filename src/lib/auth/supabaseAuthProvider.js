import { supabase } from '../../supabase';

const toUser = (user) => user ? {
  ...user,
  id: user.id,
  uid: user.id,
  displayName: user.user_metadata?.display_name || '',
  username: user.user_metadata?.username || '',
} : null;

const throwIfError = ({ error }) => { if (error) throw error; };

const onAuthStateChanged = (callback) => {
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) console.error('Failed to restore auth session:', error);
    callback(toUser(data?.session?.user));
  });
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(toUser(session?.user)));
  return () => data.subscription.unsubscribe();
};

const signIn = async (email, password, captchaToken) => throwIfError(await supabase.auth.signInWithPassword({
  email, password, options: { captchaToken },
}));
const signUp = async (email, password, captchaToken) => throwIfError(await supabase.auth.signUp({
  email, password, options: { captchaToken },
}));
const sendPasswordReset = async (email, captchaToken) => throwIfError(await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/`,
  captchaToken,
}));
const signOut = async () => throwIfError(await supabase.auth.signOut());
const updatePassword = async (password) => throwIfError(await supabase.auth.updateUser({ password }));
const updateProfile = async ({ displayName }) => throwIfError(await supabase.auth.updateUser({ data: { display_name: displayName } }));
const reauthenticate = async ({ password } = {}) => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw error || new Error('Sign in required.');
  if (!password) throw new Error('Enter your password to continue.');
  throwIfError(await supabase.auth.signInWithPassword({ email: user.email, password }));
};
const deleteAccount = async () => throwIfError(await supabase.rpc('delete_own_account'));
const getIdToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('Sign in required.');
  return data.session.access_token;
};

export default {
  onAuthStateChanged, signIn, signUp, sendPasswordReset, signOut,
  updatePassword, updateProfile, deleteAccount, reauthenticate, getIdToken,
  getPrimaryProviderId: () => 'password',
};
