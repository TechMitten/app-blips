import { useEffect, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { setUploadConsentPrompt } from '../lib/computer';

// The once-per-project question before the AI's build check uploads an
// imported codebase's source to the agent computer (lib/computer.js). Mounted
// once by App.jsx; the AI's run_build tool waits on the answer. Closing the
// dialog counts as "no", and the build carries on without the computer.
export default function ComputerUploadConsent() {
  const [pending, setPending] = useState(null);

  useEffect(() => {
    setUploadConsentPrompt(() => new Promise((resolve) => setPending({ resolve })));
    return () => setUploadConsentPrompt(null);
  }, []);

  if (!pending) return null;
  const answer = (ok) => {
    pending.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmModal
      title="Test the build on the agent computer?"
      subtitle="Asked once for this project."
      onClose={() => answer(false)}
      onConfirm={() => answer(true)}
      cancelLabel="Not now"
      confirmLabel="Upload and test"
      confirmClass="brand-fill-text inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-brand text-white hover:bg-brand-hover transition-colors"
      icon={CloudUpload}
    >
      <p className="text-sm leading-relaxed text-slate-600">
        To prove your project still builds, the AI wants to run <strong>npm run build</strong> on a small AppBlips computer in the cloud (computer.appblips.com). That uploads this project&apos;s source code (not your images or private .env files). It is deleted as soon as the check finishes.
      </p>
      <p className="text-sm leading-relaxed text-slate-600">
        If you say no, AppBlips still checks the project with the built-in checker. You can turn the agent computer off in Settings → Connectors.
      </p>
    </ConfirmModal>
  );
}
