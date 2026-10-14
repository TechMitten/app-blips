import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Edit2, FileArchive, Loader2, Sparkles, Upload, X } from 'lucide-react';
import Modal from './Modal';
import { formatBytes } from '../lib/codebase/paths';
import { completeEnvironment, environmentDraft } from '../lib/codebase/environment';
import { logError } from '../lib/errorLog';

// Imports a React + Vite project from a .zip (studioMode 'codebase'). Step
// one reads and checks the zip without saving anything; step two shows what
// was found and asks for a name, and only then does App create the project.
// The zip is parsed in the renderer (lib/codebase/import.js); nothing in it runs.

const nameFromZip = (fileName, pkgName) => {
  const base = (pkgName || fileName.replace(/\.zip$/i, '')).replace(/[-_]+/g, ' ').trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80) : 'Imported Site';
};

export default function ImportSiteDialog({ onImported, onCancel, isNameTaken, reasoningEffort }) {
  const [phase, setPhase] = useState('pick'); // pick | reading | environment | configure | adapting | review | saving
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [name, setName] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [envDraft, setEnvDraft] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const close = () => {
    if (phase === 'saving') return;
    requestRef.current?.abort();
    onCancel();
  };

  const readZip = async (file) => {
    if (!file) return;
    requestRef.current?.abort();
    setError('');
    if (!/\.zip$/i.test(file.name)) {
      setError('Choose a .zip file of the website project.');
      return;
    }
    setPhase('reading');
    const request = new AbortController();
    requestRef.current = request;
    try {
      const { importCodebaseZip } = await import('../lib/codebase/import');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imported = await importCodebaseZip(bytes, { sourceName: file.name });
      if (request.signal.aborted) return;
      setResult(imported);
      setName(nameFromZip(file.name, imported.meta.name));
      setEnvDraft(environmentDraft(imported.files, imported.environment));
      setPhase(imported.environment.detected ? 'environment' : 'review');
    } catch (err) {
      if (request.signal.aborted) return;
      logError(`Could not import ${file.name} (${file.size} bytes)`, err);
      setError(err?.message || 'This zip could not be imported.');
      setPhase('pick');
    }
  };

  const handleCompleteEnvironment = (event) => {
    event.preventDefault();
    setError('');
    try {
      setResult(completeEnvironment(result, envDraft));
      setPhase('review');
    } catch (err) { setError(err.message); }
  };

  const handleRemoveEnvironment = async () => {
    const request = new AbortController();
    requestRef.current = request;
    setError('');
    setStatus('Looking through your site’s files…');
    setPhase('adapting');
    try {
      const { prepareEnvironmentFreeSite } = await import('../lib/codebase/prepareEnvironment');
      const prepared = await prepareEnvironmentFreeSite(result, {
        signal: request.signal, reasoningEffort,
        onChunk: (text, kind) => { if (kind === 'status' && !request.signal.aborted) setStatus(text); },
      });
      if (request.signal.aborted) return;
      setResult(prepared);
      setPhase('review');
    } catch (err) {
      if (request.signal.aborted) return;
      logError('AI could not prepare the imported site without environment settings', err);
      setError(err?.message || 'AI could not prepare the site. Try again or fill in the settings yourself.');
      setPhase('environment');
    }
  };

  const trimmed = name.trim();
  const taken = Boolean(trimmed) && isNameTaken?.(trimmed);
  const canOpen = phase === 'review' && trimmed && !taken;

  const handleOpen = async (event) => {
    event?.preventDefault();
    if (!canOpen) return;
    setPhase('saving');
    setError('');
    try {
      await onImported(result, trimmed);
    } catch (err) {
      logError('Could not save the imported site', err);
      setError(err?.message || 'The site could not be saved.');
      setPhase('review');
    }
  };

  const fileCount = result ? Object.keys(result.files).length + Object.keys(result.assets).length : 0;
  const assetBytes = result ? [...result.blobs.values()].reduce((n, b) => n + b.length, 0) : 0;
  const busy = phase === 'reading' || phase === 'saving' || phase === 'adapting';

  return (
    <Modal zIndex={70} cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'import-site-title' }} cardClass="w-full max-w-md xl:max-w-lg 2xl:max-w-xl max-h-[90dvh] overflow-y-auto custom-scrollbar bg-surface rounded-2xl shadow-xl border border-slate-200 animate-scale-in">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <h2 id="import-site-title" className="text-base 2xl:text-lg font-semibold text-slate-900">Import a site</h2>
        <button
          type="button"
          onClick={close}
          disabled={phase === 'saving'}
          className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {(phase === 'pick' || phase === 'reading') && (
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Choose the <strong>.zip file</strong> of a React + Vite website project, for example one your web designer sent you.
            AppBlips keeps all of its files, so you can export it again later.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); readZip(e.dataTransfer.files?.[0]); }}
            className={`w-full rounded-xl border-2 border-dashed px-6 py-8 flex flex-col items-center gap-2 text-center transition-colors ${
              dragging ? 'border-brand bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {phase === 'reading' ? (
              <>
                <Loader2 className="animate-spin text-brand" size={26} />
                <span className="text-sm font-semibold text-slate-700">Reading the zip…</span>
              </>
            ) : (
              <>
                <Upload className="text-slate-400" size={26} />
                <span className="text-sm font-semibold text-slate-700">Click to choose a .zip, or drop it here</span>
                <span className="text-xs text-slate-400">node_modules and build folders are skipped automatically</span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => { readZip(e.target.files?.[0]); e.target.value = ''; }}
          />
          {error && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>
      )}

      {['environment', 'configure', 'adapting'].includes(phase) && result && (
        <div className="p-6 space-y-5">
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <h3 className="font-semibold">This site needs a few settings</h3>
            <p className="mt-1">We found that this website uses a <strong>.env file</strong> for settings such as service addresses or public keys. It may not work until these are supplied or the dependency is removed.</p>
            {result.environment.envFiles.length > 0 && <p className="mt-2 text-xs">The ZIP’s private settings were left out. You can enter public values below.</p>}
          </div>
          {phase === 'environment' && (
            <>
              <p className="text-sm text-slate-600">How would you like to get your site ready to edit?</p>
              <button type="button" onClick={() => { setError(''); setPhase('configure'); }} className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-brand hover:bg-slate-50 transition-colors">
                <span className="block text-sm font-semibold text-slate-900">I’ll fill in the .env settings</span>
                <span className="mt-1 block text-xs text-slate-500">Use public settings from your designer or service provider to keep connected features.</span>
              </button>
              <button type="button" onClick={handleRemoveEnvironment} className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-brand hover:bg-slate-50 transition-colors">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles size={16} />Use AI to remove the .env dependency</span>
                <span className="mt-1 block text-xs text-slate-500">Make a standalone version you can preview and edit. Connected features, such as sign-in or payments, may use demo data instead. Uses your configured AI provider.</span>
              </button>
            </>
          )}
          {phase === 'configure' && (
            <form onSubmit={handleCompleteEnvironment} className="space-y-4">
              <p className="text-sm text-slate-600">Fill in the public values below. Your designer can help you find them. These values are saved with the project, included in exports and visible to website visitors. Don’t enter passwords or private API keys.</p>
              {result.environment.variables.some((v) => !v.public) && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">This site also needs server settings ({result.environment.variables.filter((v) => !v.public).map((v) => v.name).join(', ')}). AppBlips cannot run a server in the preview. Use the AI option to make a standalone version.</p>}
              {result.environment.dynamicFiles.length > 0 && <p className="text-xs text-slate-500">Some setting names are chosen by the code. Add any other public VITE_ settings your designer provides.</p>}
              <label htmlFor="import-env-values" className="block text-sm font-semibold text-slate-700">Public .env settings</label>
              <textarea id="import-env-values" autoFocus value={envDraft} onChange={(e) => setEnvDraft(e.target.value)} rows={7} spellCheck={false} autoComplete="off" placeholder={'VITE_API_URL=https://example.com\nVITE_PUBLIC_KEY=your-public-key'} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-mono text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" />
              <p className="text-xs text-slate-500">We’ll save these as .env.local so the preview and exported project can use them. AI cannot read this file.</p>
              <div className="flex justify-between gap-3">
                <button type="button" onClick={() => { setError(''); setPhase('environment'); }} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Back</button>
                <button type="submit" className="rounded-lg px-4 py-2 text-sm font-semibold brand-fill-text bg-brand text-white hover:bg-brand-hover">Save settings</button>
              </div>
            </form>
          )}
          {phase === 'adapting' && (
            <div className="space-y-4">
              <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={18} className="animate-spin shrink-0" />{status}</p>
              <p className="text-xs text-slate-500">This may take a few minutes. Your original files will be kept so you can undo the change.</p>
              <button type="button" onClick={() => { requestRef.current?.abort(); setPhase('environment'); }} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Stop</button>
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{error}</p>}
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && result && (
        <form onSubmit={handleOpen} className="p-6 space-y-5">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Found a React + Vite project</p>
              <p className="mt-0.5 text-emerald-700">
                {fileCount} files{assetBytes ? `, ${formatBytes(assetBytes)} of images and fonts` : ''}
                {result.meta.tailwind ? ` · Tailwind CSS v${result.meta.tailwind}` : ''}
              </p>
            </div>
          </div>

          {result.meta.environmentResolution && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <p>{result.meta.environmentResolution === 'ai' ? 'AI prepared a standalone version and checked that it starts in the preview. Connected features may now use demo data. The original is available in version history.' : result.meta.environmentResolution === 'verified' ? 'This site already starts without .env settings. No code changes were needed, and it is ready to open.' : 'Your public settings are saved and ready for the preview.'}</p>
              {result.meta.environmentResolution === 'manual' && <button type="button" disabled={busy} onClick={() => { setError(''); setPhase('configure'); }} className="mt-2 font-semibold underline hover:no-underline">Edit settings</button>}
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="space-y-2">
              {result.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          {result.skipped.length > 0 && (
            <div className="text-xs text-slate-500">
              <button type="button" onClick={() => setShowSkipped((v) => !v)} className="inline-flex items-center gap-1 font-medium hover:text-slate-700">
                <ChevronDown size={14} className={`transition-transform ${showSkipped ? 'rotate-180' : ''}`} />
                {result.skipped.length} item{result.skipped.length === 1 ? ' was' : 's were'} left out
              </button>
              {showSkipped && (
                <ul className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 font-mono custom-scrollbar">
                  {result.skipped.map((s) => <li key={s.path} className="truncate">{s.path} <span className="text-slate-400">— {s.reason}</span></li>)}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="import-site-name" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Site name</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-500 transition-colors">
                <Edit2 size={16} />
              </div>
              <input
                id="import-site-name"
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-3 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>
            {taken && <p className="text-xs text-red-600" role="alert">You already have a project with this name. Pick a different one.</p>}
          </div>

          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-400">
              <FileArchive size={14} className="shrink-0" />
              <span className="truncate">{result.meta.sourceName}</span>
            </span>
            <div className="flex shrink-0 gap-3">
              <button type="button" onClick={onCancel} disabled={phase === 'saving'} className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canOpen}
                className={`inline-flex items-center gap-2 rounded-lg px-5 py-2 font-semibold transition-colors active:scale-[0.98] ${
                  !canOpen ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'brand-fill-text bg-brand text-white hover:bg-brand-hover shadow-sm'
                }`}
              >
                {phase === 'saving' && <Loader2 size={16} className="animate-spin" />}
                Open site
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
