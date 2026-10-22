import { useEffect, useState } from 'react';
import { SettingRow, SECONDARY_BUTTON } from './SettingControls';
import { surgeSignOut, surgeStatus } from '../lib/surge';

// Settings → Connectors: the Surge account Publish signs in to (PublishDialog).
// Shown only while signed in; signing in happens in the Publish window.
export default function SurgeAccountSettings() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    surgeStatus().then((status) => live && setEmail(status.signedIn ? status.email : ''));
    return () => { live = false; };
  }, []);

  if (!email) return null;
  const signOut = async () => {
    setBusy(true);
    const status = await surgeSignOut();
    setBusy(false);
    if (!status.error) setEmail('');
  };
  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      <SettingRow
        id="set-surge"
        title="Publishing (Surge)"
        description={<>Publish puts your sites online with Surge. Signed in as <strong className="text-slate-700">{email}</strong>.</>}
      >
        <button type="button" onClick={signOut} disabled={busy} className={SECONDARY_BUTTON} aria-describedby="set-surge">
          Sign out
        </button>
      </SettingRow>
    </div>
  );
}
