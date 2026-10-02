import { useEffect, useRef, useState } from 'react';
import { Download, Upload, FolderOpen, FolderInput, Loader2, CircleCheck, CircleAlert } from 'lucide-react';
import { SettingRow, SECONDARY_BUTTON } from './SettingControls';
import { isDesktop, desktopBridge, ipcErrorMessage } from '../lib/desktop';
import { readProjectRows, writeProjectRows } from '../lib/projectsStorage';
import { loadPreviewStorage, savePreviewStorage } from '../lib/previewStorage';
import { buildBackup, backupFileName, parseBackup, mergeBackup } from '../lib/projectBackup';

const RELOAD_DELAY_MS = 1200;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Settings → Data (self-hosted and desktop): back up / import saved apps as a
// JSON file (lib/projectBackup.js) and, in the desktop app, the projects
// folder on disk. Imports and folder changes reload the app so every hook
// starts from the new data instead of patching live state.
export default function DataSettings() {
  const [folder, setFolder] = useState(null);
  const [status, setStatus] = useState(null); // { kind: 'busy' | 'ok' | 'error', text }
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isDesktop) desktopBridge.folder.get().then(setFolder).catch(() => {});
  }, []);

  const reloadSoon = () => setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);

  const exportAll = () => {
    const rows = readProjectRows();
    if (!rows.length) {
      setStatus({ kind: 'error', text: 'There are no saved apps to export.' });
      return;
    }
    const backup = buildBackup(rows, loadPreviewStorage);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus({ kind: 'ok', text: `Exported ${plural(rows.length, 'app')}.` });
  };

  const importFile = async (file) => {
    if (!file) return;
    setStatus({ kind: 'busy', text: 'Importing…' });
    try {
      const { projects, skipped } = parseBackup(await file.text());
      const result = mergeBackup(readProjectRows(), projects);
      const skippedNote = skipped ? ` ${plural(skipped, 'damaged entry')} skipped.` : '';
      if (!result.added && !result.updated) {
        setStatus({ kind: 'ok', text: `Nothing to import: your saved apps are already up to date.${skippedNote}` });
        return;
      }
      writeProjectRows(result.rows);
      result.appData.forEach(({ id, map }) => savePreviewStorage(id, map));
      const parts = [result.added && `${plural(result.added, 'new app')}`, result.updated && `${result.updated} updated`].filter(Boolean);
      setStatus({ kind: 'ok', text: `Imported ${parts.join(', ')}.${skippedNote} Reloading…` });
      reloadSoon();
    } catch (err) {
      const full = err?.name === 'QuotaExceededError';
      setStatus({
        kind: 'error',
        text: full ? 'Browser storage is full. Delete some apps or use the desktop app.' : err?.message || 'Import failed.',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openFolder = () => desktopBridge.folder.open().catch((err) => setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not open the folder.' }));

  const chooseFolder = async () => {
    try {
      const result = await desktopBridge.folder.choose();
      if (!result.changed) return;
      setFolder(result.root);
      const movedNote = result.moved ? ` Moved ${plural(result.moved, 'app')}.` : '';
      setStatus({ kind: 'ok', text: `Projects folder changed.${movedNote} Reloading…` });
      reloadSoon();
    } catch (err) {
      setStatus({ kind: 'error', text: ipcErrorMessage(err) || 'Could not change the folder.' });
    }
  };

  const statusLine = status && (
    <p
      role={status.kind === 'error' ? 'alert' : 'status'}
      className={`inline-flex items-center gap-1.5 text-xs ${status.kind === 'error' ? 'text-red-600' : status.kind === 'ok' ? 'text-emerald-600' : 'text-slate-500'}`}
    >
      {status.kind === 'busy' && <Loader2 size={14} className="animate-spin" />}
      {status.kind === 'ok' && <CircleCheck size={14} />}
      {status.kind === 'error' && <CircleAlert size={14} />}
      {status.text}
    </p>
  );

  return (
    <>
      {isDesktop && (
        <SettingRow
          id="set-folder"
          title="Projects folder"
          description={(
            <>
              Each app is a folder here with its <code>project.json</code> and a <code>site/</code> copy of its current pages.
              <span className="block mt-1 break-all font-mono text-[11px] text-slate-500">{folder || '…'}</span>
            </>
          )}
        >
          <div className="flex gap-2">
            <button type="button" onClick={openFolder} className={SECONDARY_BUTTON}>
              <FolderOpen size={14} aria-hidden="true" /> Open
            </button>
            <button type="button" onClick={chooseFolder} className={SECONDARY_BUTTON}>
              <FolderInput size={14} aria-hidden="true" /> Change…
            </button>
          </div>
        </SettingRow>
      )}
      <SettingRow
        id="set-export"
        title="Export all apps"
        description="Download every saved app, its version history and its saved app data as one backup file."
      >
        <button type="button" onClick={exportAll} className={SECONDARY_BUTTON}>
          <Download size={14} aria-hidden="true" /> Export
        </button>
      </SettingRow>
      <SettingRow
        id="set-import"
        title="Import apps"
        details={statusLine}
        description={`Add apps from a backup file${isDesktop ? ', such as one exported from AppBlips in your browser' : ''}. An app you already have is replaced only if the backup's copy is newer.`}
      >
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={status?.kind === 'busy'} className={SECONDARY_BUTTON}>
          <Upload size={14} aria-hidden="true" /> Import…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-labelledby="set-import"
          onChange={(e) => importFile(e.target.files?.[0])}
        />
      </SettingRow>
    </>
  );
}
