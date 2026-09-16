import { useRef, useState } from 'react';
import {
  X, ArrowUpToLine, Sparkles, Upload, Loader2, Wand2,
} from 'lucide-react';
import { compressImageDataUrl } from '../lib/attachments';

// Floating inspector for the Website Studio's click-to-edit mode. Receives
// the bridge's element-selected payload and builds a `changes` object for
// lib/directEdits.applyDirectEdit; when a change can't be applied
// deterministically the user hands off to the chat with "Edit with AI"
// (buildElementEditPrompt). All state is local and keyed per selection --
// App remounts this component with a fresh key whenever a new element is
// picked.

const ROLE_LABELS = {
  text: 'Text',
  heading: 'Heading',
  button: 'Button',
  link: 'Link',
  image: 'Image',
  container: 'Section',
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Failed to read the image file.'));
  reader.readAsDataURL(file);
});

const rgbToHex = (rgb) => {
  if (!rgb || typeof rgb !== 'string') return null;
  const m = rgb.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  const hex = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
};

function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all';

export default function ElementEditor({
  element,
  isApplying = false,
  error = null,
  onApply,
  onEditWithAI,
  onCancel,
  onSelectParent,
}) {
  const role = element.role || 'container';
  const isImage = role === 'image';
  const isContainer = role === 'container';
  // Text editing applies to leaf text-bearing roles; containers offer
  // background editing instead (their "text" is every descendant's text).
  const showText = !isImage && !isContainer;
  const showLink = role === 'link' || role === 'button';
  const showBackground = isContainer || Boolean(element.backgroundImage);

  const [text, setText] = useState(element.text || '');
  const [src, setSrc] = useState(element.attributes?.src || '');
  const [alt, setAlt] = useState(element.attributes?.alt || '');
  const [href, setHref] = useState(element.attributes?.href || '');
  const currentBgHex = rgbToHex(element.backgroundColor) || '#ffffff';
  const [bgColor, setBgColor] = useState(currentBgHex);
  const [bgImage, setBgImage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const imageFileRef = useRef(null);
  const bgFileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setUploadError(null);
    if (!file.type?.startsWith('image/')) {
      setUploadError('Please choose an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('Image must be smaller than 8MB.');
      return;
    }
    try {
      setIsUploading(true);
      const dataUrl = await readFileAsDataUrl(file);
      const compressed = await compressImageDataUrl(dataUrl);
      if (isImage) setSrc(compressed);
      else setBgImage(compressed);
    } catch (err) {
      setUploadError(err?.message || 'Failed to process the image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleApply = () => {
    const changes = {};
    if (showText && text.trim() !== (element.text || '') && text.trim()) changes.text = text;
    if (isImage) {
      if (src.trim() && src.trim() !== (element.attributes?.src || '')) changes.src = src.trim();
      if (alt.trim() !== (element.attributes?.alt || '')) changes.alt = alt.trim();
    }
    if (showLink && href.trim() && href.trim() !== (element.attributes?.href || '')) changes.href = href.trim();
    if (showBackground) {
      if (bgColor.toLowerCase() !== currentBgHex.toLowerCase()) changes.backgroundColor = bgColor;
      if (bgImage) changes.backgroundImage = bgImage;
    }
    onApply(changes);
  };

  const handleAiSend = () => {
    onEditWithAI(aiInstruction);
  };

  return (
    <div className="element-editor rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#161824] shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold">
            {ROLE_LABELS[role] || 'Element'}
          </span>
          <span className="font-mono text-[11px] text-slate-400 dark:text-white/40 truncate">
            &lt;{element.tag}&gt;
            {element.parentTag ? ` in <${element.parentTag}>` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {element.parentSelectable && onSelectParent && (
            <button
              type="button"
              onClick={onSelectParent}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              title="Select the parent element (for sections, backgrounds, wallpapers)"
              aria-label="Select parent element"
            >
              <ArrowUpToLine size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            title="Close (Esc also deselects in the preview)"
            aria-label="Close editor"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 max-h-[45vh] overflow-y-auto custom-scrollbar">
        {isImage && element.attributes?.src && (
          <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden bg-slate-100 dark:bg-white/5 h-28 flex items-center justify-center">
            <img
              src={src || element.attributes.src}
              alt="Selected"
              className="max-h-full max-w-full object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        )}

        {showText && (
          <Field label="Text">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(4, Math.max(2, Math.ceil((text.length || 1) / 40)))}
              className={`${inputClass} resize-none`}
              disabled={isApplying}
            />
          </Field>
        )}

        {isImage && (
          <>
            <Field label="Image URL">
              <input type="text" value={src.startsWith('data:') ? '' : src} placeholder={src.startsWith('data:') ? 'Uploaded image (paste a URL to replace)' : 'https://…'} onChange={(e) => setSrc(e.target.value)} className={inputClass} disabled={isApplying || isUploading} />
            </Field>
            <div className="flex items-center gap-2">
              <input
                ref={imageFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => imageFileRef.current?.click()}
                disabled={isApplying || isUploading}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/15 transition-colors disabled:opacity-50"
              >
                {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload image
              </button>
              {src.startsWith('data:') && <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Uploaded</span>}
            </div>
            <Field label="Alt text">
              <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} className={inputClass} disabled={isApplying} />
            </Field>
          </>
        )}

        {showLink && (
          <Field label="Link URL">
            <input type="text" value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://…" className={inputClass} disabled={isApplying} />
          </Field>
        )}

        {showBackground && (
          <div className="space-y-3 rounded-xl border border-slate-100 dark:border-white/10 p-3">
            <Field label="Background color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  disabled={isApplying}
                  className="h-9 w-12 rounded-lg border border-slate-200 dark:border-white/10 bg-transparent cursor-pointer p-1"
                  aria-label="Pick background color"
                />
                <input
                  type="text"
                  value={bgColor}
                  onChange={(e) => {
                    const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                    setBgColor(v);
                  }}
                  className={inputClass}
                  disabled={isApplying}
                />
              </div>
            </Field>

            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">Background image / wallpaper</span>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={bgFileRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => bgFileRef.current?.click()}
                  disabled={isApplying || isUploading}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/15 transition-colors disabled:opacity-50"
                >
                  {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Upload
                </button>
                {bgImage && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <img src={bgImage} alt="" className="h-6 w-6 rounded object-cover border border-slate-200 dark:border-white/10" />
                    Ready to apply
                  </span>
                )}
              </div>
              {element.backgroundImage && !bgImage && (
                <p className="text-[11px] text-slate-400 dark:text-white/40 leading-snug">
                  This element has a background image — an upload replaces it. (URL-based wallpaper changes go through Edit with AI.)
                </p>
              )}
            </div>
          </div>
        )}

        {uploadError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{uploadError}</p>}
        {error && <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 leading-snug">{error}</p>}

        {showAiInput ? (
          <div className="space-y-2">
            <Field label="Describe the change">
              <textarea
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                rows={2}
                placeholder='e.g. "make this section darker with a subtle gradient"'
                className={`${inputClass} resize-none`}
              />
            </Field>
            <button
              type="button"
              onClick={handleAiSend}
              className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              <Sparkles size={14} />
              Send to chat
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAiInput(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 transition-colors"
          >
            <Wand2 size={13} />
            Edit with AI instead
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-100 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.03]">
        <button
          type="button"
          onClick={handleApply}
          disabled={isApplying || isUploading}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl brand-fill-text bg-brand hover:bg-brand-hover text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApplying ? <Loader2 size={14} className="animate-spin" /> : null}
          {isApplying ? 'Applying…' : 'Apply change'}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-white/40">
          Applied instantly and saved as a new version
        </p>
      </div>
    </div>
  );
}
