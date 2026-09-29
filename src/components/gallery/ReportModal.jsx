import { useEffect, useState } from 'react';
import { Flag, Loader2, Check } from 'lucide-react';
import Modal, { ModalCloseButton } from '../Modal';
import { reportPost, reportComment } from '../../lib/gallery';

const REASONS = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'inappropriate', label: 'Inappropriate or offensive' },
  { id: 'harmful', label: 'Harmful, malicious or phishing' },
  { id: 'other', label: 'Something else' },
];

// Reports go to gallery_reports; three distinct reporters auto-hide the
// target until it is reviewed in the Supabase dashboard.
export default function ReportModal({ target, userId, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const noun = target.type === 'comment' ? 'comment' : 'app';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    setError('');
    try {
      const text = [reason, details.trim()].filter(Boolean).join(': ');
      if (target.type === 'comment') await reportComment(target.id, userId, text);
      else await reportPost(target.id, userId, text);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal zIndex={75} cardClass="w-full max-w-sm bg-surface rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden animate-scale-in">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Flag size={17} className="text-rose-500" /> Report this {noun}
        </h2>
        <ModalCloseButton onClick={onClose} />
      </div>
      {sent ? (
        <div className="flex flex-col items-center gap-2 px-5 pb-6 pt-4 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Check size={22} />
          </span>
          <p className="text-sm text-slate-600">Thanks for letting us know. We&rsquo;ll take a look.</p>
          <button type="button" onClick={onClose} className="gallery-pill-btn mt-2">Done</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2 px-5 pb-5 pt-3">
          {REASONS.map((r) => (
            <label key={r.id} className={`gallery-report-option ${reason === r.label ? 'is-selected' : ''}`}>
              <input type="radio" name="reason" value={r.label} checked={reason === r.label} onChange={() => setReason(r.label)} className="sr-only" />
              <span className="gallery-report-radio" aria-hidden="true" />
              {r.label}
            </label>
          ))}
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 250))}
            rows={2}
            placeholder="Add details (optional)"
            className="gallery-field resize-none"
          />
          {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
          <button type="submit" disabled={!reason || sending} className="gallery-danger-btn w-full justify-center py-2.5">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Flag size={15} />} Send report
          </button>
        </form>
      )}
    </Modal>
  );
}
