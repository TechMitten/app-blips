import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import {
  MAX_DETAILS_LENGTH, MAX_SERVICE_LENGTH, sendConnectorRequest, validateConnectorRequest,
} from '../lib/connectorRequest';

const LABEL_CLASS = 'block text-sm font-semibold text-slate-900';

// "Request a connector", opened from the Connectors grid. Sends the request to
// the AppBlips team (lib/connectorRequest.js). Sits above the Settings modal
// like ConnectorInfoModal, and Escape closes only this dialog.
export default function ConnectorRequestModal({ onClose }) {
  const [service, setService] = useState('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  // Bot protection (see lib/connectorRequest.js): a honeypot people never see,
  // and when the form opened, to catch sends faster than anyone could type.
  const [botcheck, setBotcheck] = useState(false);
  const [openedAt] = useState(() => Date.now());
  // idle | sending | sent | error
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Closing mid-send drops the request instead of updating an unmounted dialog.
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async (event) => {
    event.preventDefault();
    const problem = validateConnectorRequest({ service, email });
    if (problem) {
      setState('error');
      setMessage(problem);
      return;
    }
    setState('sending');
    setMessage('');
    abortRef.current = new AbortController();
    const result = await sendConnectorRequest(
      { service, details, email, botcheck, openedAt },
      { signal: abortRef.current.signal },
    );
    if (abortRef.current?.signal.aborted) return;
    setState(result.ok ? 'sent' : 'error');
    setMessage(result.message);
  };

  const sending = state === 'sending';
  return (
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh]"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'connector-request-title' }}
    >
      <div className="shrink-0 px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 id="connector-request-title" className="text-base 2xl:text-lg font-semibold text-slate-900">
          Request a connector
        </h2>
        <ModalCloseButton onClick={onClose} />
      </div>
      {state === 'sent' ? (
        <>
          <div className="p-6 text-sm leading-relaxed text-slate-700">
            <p role="status" className="flex items-start gap-2 font-semibold text-emerald-600">
              <CircleCheck size={18} className="mt-px shrink-0" aria-hidden="true" />{message}
            </p>
            <p className="mt-2">
              {email.trim() ? 'We read every request and will email you if we have questions.' : 'We read every request.'}
            </p>
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end">
            <button type="button" onClick={onClose} autoFocus className={PRIMARY_BUTTON}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <div className="p-6 space-y-4 overflow-y-auto text-sm text-slate-700">
            <p className="text-xs leading-snug text-slate-600">
              Tell us which service you&rsquo;d like the AI to wire into your projects. Your request goes to the AppBlips team.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="connector-request-service" className={LABEL_CLASS}>Service</label>
              <input
                id="connector-request-service"
                type="text"
                value={service}
                onChange={(event) => setService(event.target.value)}
                maxLength={MAX_SERVICE_LENGTH}
                placeholder="For example, Calendly or Stripe"
                autoFocus
                className={FIELD_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="connector-request-details" className={LABEL_CLASS}>
                What should it do? <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <textarea
                id="connector-request-details"
                rows={4}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={MAX_DETAILS_LENGTH}
                placeholder="For example, add a Book a call button to my websites"
                className={`${FIELD_CLASS} resize-y`}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="connector-request-email" className={LABEL_CLASS}>
                Your email <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="connector-request-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="Only if you’d like a reply"
                aria-describedby="connector-request-privacy"
                className={FIELD_CLASS}
              />
            </div>
            {/* Honeypot: clipped out of view rather than display:none, which
                some bots skip; hidden from screen readers and the Tab order. */}
            <div aria-hidden="true" className="sr-only">
              <label htmlFor="connector-request-botcheck">Leave this unticked</label>
              <input
                id="connector-request-botcheck"
                type="checkbox"
                name="botcheck"
                tabIndex={-1}
                autoComplete="off"
                checked={botcheck}
                onChange={(event) => setBotcheck(event.target.checked)}
              />
            </div>
            <p id="connector-request-privacy" className="text-xs leading-snug text-slate-600">
              Only what you type here is sent, through the Web3Forms email service. Nothing about your projects is included.
            </p>
            {state === 'error' && message && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600">
                <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{message}
              </p>
            )}
          </div>
          <div className="shrink-0 bg-slate-50 px-6 py-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>Cancel</button>
            <button type="submit" disabled={sending} className={PRIMARY_BUTTON}>
              {sending ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
