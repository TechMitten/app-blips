import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, ExternalLink, Loader2 } from 'lucide-react';
import { ConfirmedLink } from './ExternalLinkConfirm';
import { SettingRow, Switch, FIELD_CLASS, SECONDARY_BUTTON } from './SettingControls';
import PixabaySearch from './PixabaySearch';
import { CONNECTOR_DEFINITIONS } from '../lib/connectors';
import { forgetPixabayKey, pixabayStatus, savePixabayKey } from '../lib/pixabay';

// Settings → Connectors → Pixabay. The key is sent once to /api/pixabay/key,
// which checks it with Pixabay and keeps it server-side (pixabayApi.js); the
// connector state only records its last four characters (`keyHint`), which is
// what makes it 'connected'. Once connected the page shows the photo search.
export default function PixabayConnector({ state, onChange, galleryProject, imagesEnabled, onEnableImages }) {
  const def = CONNECTOR_DEFINITIONS.pixabay;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The saved key can disappear behind our back (a new computer, a deleted
  // key file, a JSON restore), so the server has the last word on the hint.
  useEffect(() => {
    let live = true;
    pixabayStatus().then((status) => {
      if (!live || status.error) return;
      const hint = status.connected ? status.hint || '' : '';
      if (hint !== state.keyHint) onChange({ keyHint: hint });
    });
    return () => { live = false; };
    // Once per visit to the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (event) => {
    event.preventDefault();
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError('');
    const result = await savePixabayKey(draft);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft('');
    onChange({ keyHint: result.hint });
  };

  const remove = async () => {
    setError('');
    const result = await forgetPixabayKey();
    if (result.error) setError(result.error);
    else onChange({ keyHint: '' });
  };

  const connected = state.enabled && Boolean(state.keyHint);
  return (
    <>
      <SettingRow id="set-pixabay" title="Enable Pixabay" description={def.page.enableDescription}>
        <Switch checked={state.enabled} onChange={(enabled) => onChange({ enabled })} labelledBy="set-pixabay" />
      </SettingRow>
      {state.enabled && (
        <div className="py-4 space-y-2">
          {state.keyHint
            ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="inline-flex min-w-0 flex-1 items-start gap-1.5 text-xs text-emerald-600">
                  <CircleCheck size={14} className="mt-px shrink-0" aria-hidden="true" />
                  {`Connected with the key ending in ${state.keyHint}. ${def.page.connected}`}
                </p>
                <button type="button" onClick={remove} className={SECONDARY_BUTTON}>Remove key</button>
              </div>
            )
            : (
              <form onSubmit={save} className="space-y-2">
                <label htmlFor="set-pixabay-key" className="block text-sm font-semibold text-slate-900">{def.keyLabel}</label>
                <div className="flex gap-2">
                  <input
                    id="set-pixabay-key"
                    type="password"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={def.keyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(error)}
                    aria-describedby="set-pixabay-help"
                    className={`${FIELD_CLASS} font-mono`}
                  />
                  <button type="submit" className={`${SECONDARY_BUTTON} shrink-0`} disabled={saving || !draft.trim()}>
                    {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                    {saving ? 'Checking…' : 'Save key'}
                  </button>
                </div>
                <p id="set-pixabay-help" className="text-xs leading-snug text-slate-600">
                  {def.page.keyHelp}{' '}
                  <ConfirmedLink href={def.keyUrl} why="To copy your Pixabay API key. Pixabay shows it on its API documentation page once you are signed in." className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
                    {def.page.keyLinkLabel}<ExternalLink size={11} aria-hidden="true" />
                  </ConfirmedLink>
                </p>
                {!error && <p role="status" className="text-xs text-slate-600">{def.page.needsKey}</p>}
              </form>
            )}
          {error && (
            <p role="alert" className="inline-flex items-start gap-1.5 text-xs text-red-600">
              <CircleAlert size={14} className="mt-px shrink-0" aria-hidden="true" />{error}
            </p>
          )}
        </div>
      )}
      {connected && (
        <div>
          <h4 className="pt-4 text-sm font-semibold text-slate-900">Find photos</h4>
          <PixabaySearch galleryProject={galleryProject} imagesEnabled={imagesEnabled} onEnableImages={onEnableImages} />
        </div>
      )}
    </>
  );
}
