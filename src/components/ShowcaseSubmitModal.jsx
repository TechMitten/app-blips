import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import {
  MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_PROJECT_NAME_LENGTH, MAX_URL_LENGTH, SUBMISSION_KINDS,
  sendShowcaseSubmission, validateShowcaseSubmission,
} from '../lib/showcase';

const LABEL_CLASS = 'block text-sm font-semibold text-slate-900';

// "Submit to the showcase": sends a published project to the AppBlips team
// for review (lib/showcase.js). Opened from the Showcase and from Publish,
// which pre-fills the address. Sits above whichever modal opened it, and
// Escape closes only this dialog.
export default function ShowcaseSubmitModal({ onClose, initialUrl = '', initialProjectName = '', initialKind = '', zIndex = 80 }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [projectName, setProjectName] = useState(initialProjectName);
  const [projectUrl, setProjectUrl] = useState(initialUrl);
  const [kind, setKind] = useState(SUBMISSION_KINDS.some((option) => option.key === initialKind) ? initialKind : '');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  // Bot protection (see lib/appblipsInbox.js): a honeypot people never see,
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

  // Closing mid-send drops the submission instead of updating an unmounted dialog.
  useEffect(() => () => abortRef.current?.abort(), []);

  const fields = { name, email, projectName, projectUrl, kind, description, consent };
  const submit = async (event) => {
    event.preventDefault();
    const problem = validateShowcaseSubmission(fields);
    if (problem) {
      setState('error');
      setMessage(problem);
      return;
    }
    setState('sending');
    setMessage('');
    abortRef.current = new AbortController();
    const result = await sendShowcaseSubmission(
      { ...fields, botcheck, openedAt },
      { signal: abortRef.current.signal },
    );
    if (abortRef.current?.signal.aborted) return;
    setState(result.ok ? 'sent' : 'error');
    setMessage(result.message);
  };

  const sending = state === 'sending';
  return (
    <Modal
      zIndex={zIndex}
      cardClass="w-full max-w-md xl:max-w-lg bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh]"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'showcase-submit-title' }}
    >
      <div className="shrink-0 px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 id="showcase-submit-title" className="text-base 2xl:text-lg font-semibold text-slate-900">
          Submit to the showcase
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
              We look at every submission. If we feature it, we&rsquo;ll email you at {email.trim()} before it goes live.
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
              Built something you&rsquo;re proud of? Send us its public link. The AppBlips team reviews every
              submission, and approved projects appear in the showcase in the app and on appblips.com.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="showcase-submit-name" className={LABEL_CLASS}>Your name</label>
                <input
                  id="showcase-submit-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="name"
                  autoFocus
                  className={FIELD_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="showcase-submit-email" className={LABEL_CLASS}>Your email</label>
                <input
                  id="showcase-submit-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="So we can reply"
                  className={FIELD_CLASS}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="showcase-submit-project" className={LABEL_CLASS}>Project name</label>
              <input
                id="showcase-submit-project"
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                maxLength={MAX_PROJECT_NAME_LENGTH}
                placeholder="For example, Ray’s Barber Shop"
                className={FIELD_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="showcase-submit-url" className={LABEL_CLASS}>Published link</label>
              <input
                id="showcase-submit-url"
                type="url"
                inputMode="url"
                value={projectUrl}
                onChange={(event) => setProjectUrl(event.target.value)}
                maxLength={MAX_URL_LENGTH}
                placeholder="https://my-project.surge.sh"
                aria-describedby="showcase-submit-url-hint"
                className={FIELD_CLASS}
              />
              <p id="showcase-submit-url-hint" className="text-xs leading-snug text-slate-500">
                Where anyone can open it. Not published yet? Use <span className="font-medium">Publish</span> in the
                workspace to put it online for free.
              </p>
            </div>
            <fieldset className="space-y-1.5">
              <legend className={LABEL_CLASS}>It&rsquo;s a&hellip;</legend>
              <div className="flex flex-wrap gap-2 pt-1">
                {SUBMISSION_KINDS.map((option) => (
                  <label
                    key={option.key}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400/60 ${
                      kind === option.key ? 'border-indigo-500 bg-indigo-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="showcase-submit-kind"
                      value={option.key}
                      checked={kind === option.key}
                      onChange={() => setKind(option.key)}
                      className="accent-brand"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="showcase-submit-description" className={LABEL_CLASS}>
                Tell us about it <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <textarea
                id="showcase-submit-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={MAX_DESCRIPTION_LENGTH}
                placeholder="What it does, and the prompt you started from"
                className={`${FIELD_CLASS} resize-y`}
              />
            </div>
            <label className="flex items-start gap-2.5 text-xs leading-snug text-slate-700">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              />
              <span>
                I made this project, and AppBlips may show it, its name and a screenshot in the showcase, credited to my name.
              </span>
            </label>
            {/* Honeypot: clipped out of view rather than display:none, which
                some bots skip; hidden from screen readers and the Tab order. */}
            <div aria-hidden="true" className="sr-only">
              <label htmlFor="showcase-submit-botcheck">Leave this unticked</label>
              <input
                id="showcase-submit-botcheck"
                type="checkbox"
                name="botcheck"
                tabIndex={-1}
                autoComplete="off"
                checked={botcheck}
                onChange={(event) => setBotcheck(event.target.checked)}
              />
            </div>
            <p className="text-xs leading-snug text-slate-600">
              Only what you type here is sent, through the Web3Forms email service. Your email is never shown publicly.
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
              {sending ? 'Sending…' : 'Submit project'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
