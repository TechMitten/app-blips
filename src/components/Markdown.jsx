import { parseInlineMarkdown, parseMarkdownBlocks } from '../lib/markdown';

// Renders assistant chat replies (markdown) inside the transcript bubbles.
// Plain React text nodes throughout — LLM output is never treated as HTML.
const INLINE_CODE_CLS =
  'font-mono text-[length:var(--chat-code-text)] px-1.5 py-0.5 rounded-md bg-slate-200/80 dark:bg-white/10 text-slate-800 dark:text-white border border-slate-300/40 dark:border-white/10 break-words';

const renderInline = (tokens, keyPrefix) =>
  tokens.map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (tok.type) {
      case 'code':
        return <code key={key} className={INLINE_CODE_CLS}>{tok.text}</code>;
      case 'strong':
        return (
          <strong key={key} className="font-semibold">
            {renderInline(parseInlineMarkdown(tok.text), key)}
          </strong>
        );
      case 'em':
        return (
          <em key={key}>
            {renderInline(parseInlineMarkdown(tok.text), key)}
          </em>
        );
      case 'link': {
        if (!/^https?:\/\//i.test(tok.href)) {
          return <span key={key}>{tok.text}</span>;
        }
        return (
          <a
            key={key}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-indigo-600 dark:text-indigo-400 break-all hover:opacity-80"
          >
            {tok.text}
          </a>
        );
      }
      default:
        return <span key={key}>{tok.text}</span>;
    }
  });

const HEADING_SIZE = {
  1: 'text-[length:var(--chat-h1)]',
  2: 'text-[length:var(--chat-h2)]',
  3: 'text-[length:var(--chat-h3)]',
};

export default function Markdown({ text }) {
  const blocks = parseMarkdownBlocks(text);
  if (!blocks.length) return null;

  return (
    <div className="space-y-1.5 text-slate-900 dark:text-white">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'code':
            return (
              <div
                key={i}
                className="rounded-lg overflow-hidden bg-slate-900 text-slate-100 dark:bg-black/60 dark:text-white border border-slate-700/50 dark:border-white/10"
              >
                {block.lang && (
                  <div className="px-2.5 pt-1.5 font-mono text-[length:var(--chat-label-text)] font-medium uppercase tracking-wider text-slate-400 dark:text-white/60">
                    {block.lang}
                  </div>
                )}
                <pre className="px-2.5 py-2 overflow-x-auto font-mono text-[length:var(--chat-code-text)] leading-snug">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          case 'heading': {
            const size = HEADING_SIZE[block.level] || HEADING_SIZE[3];
            return (
              <p key={i} className={`font-semibold text-slate-900 dark:text-white ${size}`}>
                {renderInline(block.inline, `h${i}`)}
              </p>
            );
          }
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            return (
              <ListTag
                key={i}
                className={`my-0.5 pl-5 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {block.items.map((item, j) => (
                  <li key={j} className="leading-relaxed whitespace-pre-wrap">
                    {renderInline(item, `${i}-${j}`)}
                  </li>
                ))}
              </ListTag>
            );
          }
          default:
            return (
              <p key={i} className="leading-relaxed whitespace-pre-wrap">
                {renderInline(block.inline, `p${i}`)}
              </p>
            );
        }
      })}
    </div>
  );
}
