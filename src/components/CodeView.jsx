import { useLayoutEffect, useRef } from 'react';
import { Code2, Check, Copy, Loader2 } from 'lucide-react';
import { syntaxHighlightHtml } from '../lib/helpers';

// Editor-styled read-only view of the generated (or streaming) HTML.
export default function CodeView({
  code, isGenerating, copied, onCopy, autoFollow = true,
  pages = [], activePage = 'index.html', writingPage = null, onSelectPage,
}) {
  const hasTabs = pages.length > 1;
  const scrollRef = useRef(null);
  // Tracks whether the view should keep following new lines as they stream in;
  // cleared when the user scrolls away from the bottom to read earlier code.
  const stickToBottomRef = useRef(true);

  useLayoutEffect(() => {
    if (isGenerating) stickToBottomRef.current = true;
  }, [isGenerating]);

  useLayoutEffect(() => {
    if (!autoFollow || !isGenerating || !stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [code, isGenerating, autoFollow]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  };

  return (
    <div className="code-view palette-stock min-w-0 w-full h-full bg-black rounded-lg overflow-hidden shadow-lg border border-neutral-800 flex flex-col">
      <div className="bg-black px-4 py-2 flex items-center border-b border-neutral-800">
        <div className="flex space-x-1.5 mr-4">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]"></div>
        </div>
        {hasTabs ? (
          <div className="flex min-w-0 items-end gap-0.5 self-stretch -mb-2 overflow-x-auto custom-scrollbar" role="tablist" aria-label="Site pages">
            {pages.map((name) => {
              const isActive = name === activePage;
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectPage?.(name)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 font-mono text-xs transition-colors ${
                    isActive
                      ? 'border-blue-400 bg-neutral-900 text-white'
                      : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {name === writingPage && <Loader2 className="animate-spin text-blue-400" size={11} aria-label="Writing" />}
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-slate-400 font-mono">{activePage}</span>
        )}
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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto bg-black custom-scrollbar">
        {code ? (
          <>
            {isGenerating && (!writingPage || writingPage === activePage) && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-blue-500/20 bg-black/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-blue-300 backdrop-blur-sm">
                <Loader2 className="animate-spin" size={12} />
                <span>{writingPage ? `Streaming ${writingPage}` : 'Streaming'}</span>
              </div>
            )}
            <div
              className="py-4 font-mono text-[13px] leading-relaxed whitespace-pre min-w-max text-[#cfd8f3]"
              dangerouslySetInnerHTML={{ __html: syntaxHighlightHtml(code) }}
            />
          </>
        ) : isGenerating ? (
          <div className="flex items-center justify-center h-full space-x-2.5 text-blue-400 font-mono text-sm">
            <Loader2 className="animate-spin" size={16} />
            <span>Generating...</span>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 font-mono text-sm">
            <Code2 size={36} className="mb-3 text-slate-500" />
            <span>// No code yet</span>
          </div>
        )}
      </div>
    </div>
  );
}
