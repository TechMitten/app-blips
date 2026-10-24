// "Request a connector" (Settings → Connectors) emails the AppBlips team
// through Web3Forms (lib/appblipsInbox.js).
import { COOLDOWN_MS, EMAIL_RE, looksLikeBot, postToAppBlipsInbox } from './appblipsInbox.js';

export { MIN_FILL_MS, COOLDOWN_MS } from './appblipsInbox.js';
export const MAX_SERVICE_LENGTH = 100;
export const MAX_DETAILS_LENGTH = 2000;

// '' when the form can be sent, otherwise what to fix.
export const validateConnectorRequest = ({ service = '', email = '' }) => {
  if (!service.trim()) return 'Enter the service you would like to connect.';
  if (email.trim() && !EMAIL_RE.test(email.trim())) return 'That email address doesn’t look right. Fix it or leave it empty.';
  return '';
};

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
  if (looksLikeBot({ botcheck, openedAt }, time)) return { ok: true, message: SENT_MESSAGE };
  if (time - lastSentAt < COOLDOWN_MS) {
    return { ok: false, message: 'You just sent a request. Please wait a minute before sending another.' };
  }
  const name = service.trim().slice(0, MAX_SERVICE_LENGTH);
  const fields = {
    subject: `Connector request: ${name}`,
    service: name,
    details: details.trim().slice(0, MAX_DETAILS_LENGTH) || '(none)',
  };
  // Web3Forms uses `email` as the reply-to address, so only send one if given.
  if (email.trim()) fields.email = email.trim();
  const result = await postToAppBlipsInbox(fields, { fetchImpl, signal });
  if (!result.ok) return result;
  lastSentAt = time;
  return { ok: true, message: SENT_MESSAGE };
};
