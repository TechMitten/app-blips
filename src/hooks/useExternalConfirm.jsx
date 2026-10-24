import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { PRIMARY_BUTTON } from '../components/SettingControls';

// Every Settings button that leaves AppBlips goes through here, so the customer
// is told where they are going and why before anything opens.
// `ask({ url, site, why }, action)` shows the dialog; `action` runs on Continue
// (it defaults to opening `url` in a new tab). Render `dialog` once.
export function useExternalConfirm() {
  const [pending, setPending] = useState(null);

  const ask = (info, action) => setPending({ info, action });
  const close = () => setPending(null);
  const confirm = () => {
    const { info, action } = pending;
    close();
    if (action) action();
    else {
      try { window.open(info.url, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ }
    }
  };

  const host = (info) => {
    try { return new URL(info.url).hostname; } catch { return ''; }
  };

  const dialog = pending && (
    <ConfirmModal
      title={`Open ${pending.info.site || host(pending.info) || 'this website'}?`}
      subtitle="This leaves AppBlips"
      onClose={close}
      onConfirm={confirm}
      confirmLabel="Continue"
      icon={ExternalLink}
      confirmClass={PRIMARY_BUTTON}
    >
      <p className="text-sm text-slate-700">
        {host(pending.info)
          ? <>This opens <span className="font-semibold">{host(pending.info)}</span> in your web browser.</>
          : <>This opens a page on another website in your web browser.</>}
      </p>
      <p className="text-sm text-slate-700">
        <span className="font-semibold">Why:</span> {pending.info.why}
      </p>
    </ConfirmModal>
  );

  return { ask, dialog };
}
