// The forms that email the AppBlips team ("Request a connector" and "Submit to
// the showcase") post through Web3Forms. These are the only places the app
// itself contacts Web3Forms, and only when the user presses Send. The access
// key is public by design: it can only deliver mail to the AppBlips inbox, so
// it is fine in the bundle.
import { CURRENT_VERSION } from './updates.js';

export const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
export const APPBLIPS_FORMS_KEY = 'c0b38db4-3383-420f-aaff-4da44dad333b';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Basic bot protection. It only stops scripts that drive the forms; the key is
// public, so anything posting to Web3Forms directly is Web3Forms' own spam
// filtering to catch. A filled honeypot or a send faster than a person could
// type looks like success to the sender, so a bot learns nothing.
export const MIN_FILL_MS = 3000;
export const COOLDOWN_MS = 60_000;

// True when the send should be dropped silently (honeypot or too fast).
export const looksLikeBot = ({ botcheck = false, openedAt = -Infinity }, time) => (
  Boolean(botcheck) || time - openedAt < MIN_FILL_MS
);

// Posts `fields` (plus the key, version and Web3Forms' own honeypot) and
// resolves to { ok, message }; never throws. On failure `message` is shown to
// the user, and is '' when the send was aborted by closing the dialog.
export const postToAppBlipsInbox = async (fields, { fetchImpl = fetch, signal } = {}) => {
  const body = {
    access_key: APPBLIPS_FORMS_KEY,
    from_name: 'AppBlips',
    ...fields,
    app_version: CURRENT_VERSION,
    // Web3Forms' own honeypot field: it rejects submissions where it is set.
    botcheck: false,
  };
  try {
    const response = await fetchImpl(WEB3FORMS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const reply = await response.json().catch(() => ({}));
    if (response.ok && reply.success) return { ok: true, message: '' };
    return { ok: false, message: reply.message ? `It wasn’t sent: ${reply.message}` : 'It wasn’t sent. Please try again in a moment.' };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, message: '' };
    return { ok: false, message: 'It couldn’t be sent. Check your internet connection and try again.' };
  }
};
