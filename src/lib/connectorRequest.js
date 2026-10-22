// "Request a connector" (Settings → Connectors) emails the AppBlips team
// through Web3Forms. This is the one place the app itself contacts Web3Forms,
// and only when the user presses Send. The access key is public by design: it
// can only deliver mail to the AppBlips inbox, so it is fine in the bundle.
import { CURRENT_VERSION } from './updates.js';

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
const APPBLIPS_FORMS_KEY = 'c0b38db4-3383-420f-aaff-4da44dad333b';

export const MAX_SERVICE_LENGTH = 100;
export const MAX_DETAILS_LENGTH = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// '' when the form can be sent, otherwise what to fix.
export const validateConnectorRequest = ({ service = '', email = '' }) => {
  if (!service.trim()) return 'Enter the service you would like to connect.';
  if (email.trim() && !EMAIL_RE.test(email.trim())) return 'That email address doesn’t look right. Fix it or leave it empty.';
  return '';
};

// Basic bot protection. It only stops scripts that drive the form; the key is
// public, so anything posting to Web3Forms directly is Web3Forms' own spam
// filtering to catch. A filled honeypot or a send faster than a person could
// type looks like success to the sender, so a bot learns nothing.
export const MIN_FILL_MS = 3000;
export const COOLDOWN_MS = 60_000;
const SENT_MESSAGE = 'Thanks! Your request was sent.';
let lastSentAt = -Infinity;

// Resolves to { ok, message }; never throws. `message` is shown to the user.
// `botcheck` is the hidden honeypot's value, `openedAt` when the form opened.
export const sendConnectorRequest = async (
  { service = '', details = '', email = '', botcheck = false, openedAt = -Infinity },
  { fetchImpl = fetch, signal, now = Date.now } = {},
) => {
  const problem = validateConnectorRequest({ service, email });
  if (problem) return { ok: false, message: problem };
  const time = now();
  if (botcheck || time - openedAt < MIN_FILL_MS) return { ok: true, message: SENT_MESSAGE };
  if (time - lastSentAt < COOLDOWN_MS) {
    return { ok: false, message: 'You just sent a request. Please wait a minute before sending another.' };
  }
  const name = service.trim().slice(0, MAX_SERVICE_LENGTH);
  const body = {
    access_key: APPBLIPS_FORMS_KEY,
    subject: `Connector request: ${name}`,
    from_name: 'AppBlips',
    service: name,
    details: details.trim().slice(0, MAX_DETAILS_LENGTH) || '(none)',
    app_version: CURRENT_VERSION,
    // Web3Forms' own honeypot field: it rejects submissions where it is set.
    botcheck: false,
  };
  // Web3Forms uses `email` as the reply-to address, so only send one if given.
  if (email.trim()) body.email = email.trim();
  try {
    const response = await fetchImpl(WEB3FORMS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const reply = await response.json().catch(() => ({}));
    if (response.ok && reply.success) {
      lastSentAt = time;
      return { ok: true, message: SENT_MESSAGE };
    }
    return { ok: false, message: reply.message ? `It wasn’t sent: ${reply.message}` : 'It wasn’t sent. Please try again in a moment.' };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, message: '' };
    return { ok: false, message: 'It couldn’t be sent. Check your internet connection and try again.' };
  }
};
