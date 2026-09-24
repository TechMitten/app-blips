import { useState } from 'react';
import { ChevronRight, Copy, Download, Lock, Trash2, X } from 'lucide-react';
import { clearRawLog } from '../lib/rawLog';

const toText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

// Tool-call arguments are shown verbatim, not re-escaped inside a JSON blob,
// so generated code stays readable.
const toolCallsText = (calls) =>
  calls.map((tc) => `# ${tc.function?.name || '(unnamed)'}${tc.id ? `  [${tc.id}]` : ''}\n${tc.function?.arguments ?? ''}`).join('\n\n');

// Body renders only while open: a long stream or a request carrying the whole
// codebase is megabytes of text, and the log holds dozens of entries.
function Section({ title, getText }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = open ? getText() : '';

  const copy = async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="border-t border-slate-100">
      <div className="flex items-center justify-between pr-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          {title}
        </button>
        <button type="button" onClick={copy} className="text-[11px] text-slate-400 hover:text-slate-700 inline-flex items-center gap-1">
          <Copy size={11} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open && (
        <pre className="mx-3 mb-2 max-h-96 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-all">
          {text || '(empty)'}
        </pre>
      )}
    </div>
  );
}

function Entry({ entry }) {
  const [open, setOpen] = useState(false);
  const failed = Boolean(entry.error) || (entry.status && entry.status >= 400);
  const time = new Date(entry.ts).toLocaleTimeString();
  const meta = [
    entry.attempt > 1 ? `attempt ${entry.attempt}` : null,
    entry.status || null,
    entry.durationMs != null ? `${(entry.durationMs / 1000).toFixed(1)}s` : null,
    entry.finishReason || null,
    entry.usage?.total_tokens ? `${entry.usage.total_tokens} tok` : null,
    entry.truncated ? 'stream truncated' : null,
    entry.willRetry ? 'retrying' : null,
  ].filter(Boolean).join(' · ');
  const inFlight = entry.kind === 'request' && entry.durationMs == null;

  return (
    <li className="rounded-lg border border-slate-200 bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
      >
        <ChevronRight size={14} className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <span className="truncate">{entry.label}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{entry.kind.replace('_', ' ')}</span>
            {failed && <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] uppercase text-red-500">error</span>}
            {inFlight && <span className="shrink-0 text-[10px] uppercase text-slate-400">live</span>}
          </span>
          <span className="block text-[11px] text-slate-400">{time}{meta ? ` · ${meta}` : ''}</span>
        </span>
      </button>
      {open && (
        <div>
          {entry.request && <Section title="Request body" getText={() => toText(entry.request)} />}
          {entry.rawStream?.length > 0 && <Section title={`Raw stream (${entry.rawStream.length} lines)`} getText={() => entry.rawStream.join('\n')} />}
          {entry.response && <Section title="Response (non-streamed)" getText={() => toText(entry.response)} />}
          {entry.text && <Section title="Assembled text" getText={() => entry.text} />}
          {entry.reasoning && <Section title="Reasoning" getText={() => entry.reasoning} />}
          {entry.toolCalls?.length > 0 && <Section title={`Tool calls (${entry.toolCalls.length})`} getText={() => toolCallsText(entry.toolCalls)} />}
          {entry.kind === 'tool_result' && (
            <>
              <Section title="Tool call" getText={() => toolCallsText([entry.toolCall])} />
              <Section title="Result sent back to the model" getText={() => toText(entry.result)} />
            </>
          )}
          {entry.kind === 'note' && <Section title="Message sent to the model" getText={() => entry.text} />}
          {entry.errorBody && <Section title="Error body" getText={() => toText(entry.errorBody)} />}
          {entry.error && <Section title="Error" getText={() => entry.error} />}
        </div>
      )}
    </li>
  );
}

// Right-hand drawer. Not a modal on purpose (no .modal-scrim): the workspace
// and its shortcuts stay usable so a build can be watched while it streams.
export default function RawLogPanel({ entries, onClose, onLock }) {
  const download = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appblips-raw-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      aria-label="Raw LLM log"
      className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-200 bg-surface shadow-2xl"
      style={{ zIndex: 75 }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Raw LLM log</h2>
          <p className="text-[11px] text-slate-400">{entries.length} entries · memory only, cleared on reload</p>
        </div>
        <div className="flex items-center gap-1 text-slate-500">
          <button type="button" onClick={download} disabled={!entries.length} title="Download JSON" className="rounded p-1.5 hover:bg-slate-50 disabled:opacity-40"><Download size={15} /></button>
          <button type="button" onClick={clearRawLog} disabled={!entries.length} title="Clear" className="rounded p-1.5 hover:bg-slate-50 disabled:opacity-40"><Trash2 size={15} /></button>
          <button type="button" onClick={onLock} title="Lock and clear (stops logging)" className="rounded p-1.5 hover:bg-slate-50"><Lock size={15} /></button>
          <button type="button" onClick={onClose} title="Hide" className="rounded p-1.5 hover:bg-slate-50"><X size={15} /></button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="p-4 text-center text-sm text-slate-400">Nothing captured yet. Run a build or edit — traffic is recorded from the moment you unlock.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
          </ul>
        )}
      </div>
      <footer className="border-t border-slate-100 px-4 py-2 text-[11px] leading-snug text-slate-400">
        Shows what the browser sent and received. The proxy may still change the request server-side (tool_choice downgrades, reasoning mapping, image-to-text substitution for text-only models).
      </footer>
    </aside>
  );
}
