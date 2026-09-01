import { Code2, Check, Copy, Loader2 } from 'lucide-react';
import { syntaxHighlightHtml } from '../lib/helpers';

// Editor-styled read-only view of the generated (or streaming) HTML.
export default function CodeView({ code, isGenerating, copied, onCopy }) {
  return (
    <div className="palette-stock w-full h-full bg-[#1a1b26] rounded-lg overflow-hidden shadow-lg border border-slate-800/50 flex flex-col">
      <div className="bg-[#24253a] px-4 py-2 flex items-center border-b border-black/30">
        <div className="flex space-x-1.5 mr-4">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
        </div>
        <span className="text-xs text-slate-400 font-mono">index.html</span>
        <div className="flex-1"></div>
        {code && (
          <button
            onClick={onCopy}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
              copied
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title="Copy to clipboard"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto bg-[#1a1b26] custom-scrollbar">
        {code ? (
          <>
            {isGenerating && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-blue-500/10 bg-[#1a1b26]/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-blue-300 backdrop-blur-sm">
                <Loader2 className="animate-spin" size={12} />
                <span>Streaming</span>
              </div>
            )}
            <div
              className="py-4 font-mono text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: syntaxHighlightHtml(code) }}
            />
          </>
        ) : isGenerating ? (
          <div className="flex items-center justify-center h-full space-x-2.5 text-blue-400/50 font-mono text-sm">
            <Loader2 className="animate-spin" size={16} />
            <span>Generating...</span>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 font-mono text-sm opacity-40">
            <Code2 size={36} className="mb-3 text-slate-700" />
            <span>// No code yet</span>
          </div>
        )}
      </div>
    </div>
  );
}
