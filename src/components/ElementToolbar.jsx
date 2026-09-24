import { useRef, useState } from 'react';
import {
  X, ArrowUpToLine, ArrowLeft, Sparkles, Upload, Loader2, Wand2, Link2, Type, Check, AlertTriangle,
} from 'lucide-react';
import { compressImageDataUrl } from '../lib/attachments';

// Contextual toolbar for the Website Studio's click-to-edit mode. It docks
// under the preview toolbar (PreviewPane owns the dock, so the bar slides in
// once and stays put while the selection changes) and speaks the same
// language as the bars above it: segmented tracks, ghost keys, one filled
// key. Text is edited IN PLACE on the page (the bridge's contentEditable
// session -- see src/previewBridge.js), so this bar owns everything else:
// image URL / upload, alt, link URL, background color / wallpaper. Text roles
// land here only via the Esc escape hatch or a failed in-place apply; the bar
// then offers select-parent and the "Ask AI" handoff (buildElementEditPrompt).
// All state is local and keyed per selection -- PreviewPane remounts this
// component with a fresh key whenever a new element is picked.

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

export default function ElementToolbar({
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
  // Text is edited in place on the page, so there is no text field here;
  // leaf text-bearing roles only reach this bar via the Esc escape hatch or a
  // failed in-place apply.
  const isTextRole = !isImage && !isContainer;
  const showLink = role === 'link' || role === 'button';
  const showBackground = isContainer || Boolean(element.backgroundImage);
  const hasEditableFields = isImage || showLink || showBackground;

  const [src, setSrc] = useState(element.attributes?.src || '');
  const [alt, setAlt] = useState(element.attributes?.alt || '');
  const [href, setHref] = useState(element.attributes?.href || '');
  const currentBgHex = rgbToHex(element.backgroundColor) || '#ffffff';
  const [bgColor, setBgColor] = useState(currentBgHex);
  const [bgImage, setBgImage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  // A failed in-place apply opens the bar with the error already set -- skip
  // straight to the AI input instead of asking for another click.
  const [showAiInput, setShowAiInput] = useState(Boolean(error));
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

  const submitOnEnter = (fn) => (e) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fn();
    }
  };

  const busy = isApplying || isUploading;
  const message = error || uploadError;

  const fileInput = (ref) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        handleFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  const uploadButton = (ref, label, tip) => (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      disabled={busy}
      className="nav-btn nav-btn-secondary element-bar-btn"
      data-tip={tip}
    >
      {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
      <span>{label}</span>
    </button>
  );

  return (
    <div
      className="element-bar"
      role="toolbar"
      aria-label={`Edit selected ${ROLE_LABELS[role] || 'element'}`}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      {/* What is selected */}
      <div className="element-bar-id">
        <span className="element-bar-chip">{ROLE_LABELS[role] || 'Element'}</span>
        <span className="element-bar-path" title={`<${element.tag}>${element.parentTag ? ` in <${element.parentTag}>` : ''}`}>
          &lt;{element.tag}&gt;
          {element.parentTag ? <span className="element-bar-path-parent"> in &lt;{element.parentTag}&gt;</span> : null}
        </span>
        {element.parentSelectable && onSelectParent && (
          <button
            type="button"
            onClick={onSelectParent}
            className="nav-btn nav-ghost nav-btn-icon element-bar-btn-icon"
            aria-label="Select parent element"
            data-tip="Select the parent (sections, backgrounds, wallpapers)"
          >
            <ArrowUpToLine size={16} />
          </button>
        )}
      </div>

      <span className="chrome-divider element-bar-divider" aria-hidden="true" />

      {/* What you can change */}
      <div className="element-bar-body">
        {showAiInput ? (
          <>
            {message && (
              <p className="element-bar-message" title={message}>
                <AlertTriangle size={14} className="shrink-0" />
                <span>{message}</span>
              </p>
            )}
            <input
              type="text"
              autoFocus
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onKeyDown={submitOnEnter(handleAiSend)}
              placeholder='Describe the change, e.g. "make this section darker with a subtle gradient"'
              aria-label="Describe the change for AI"
              className="element-bar-input element-bar-grow"
            />
          </>
        ) : (
          <>
            {isImage && (
              <>
                {(src || element.attributes?.src) && (
                  <img
                    src={src || element.attributes.src}
                    alt=""
                    className="element-bar-thumb"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                <input
                  type="text"
                  value={src.startsWith('data:') ? '' : src}
                  placeholder={src.startsWith('data:') ? 'Uploaded image (paste a URL to replace)' : 'Image URL  https://…'}
                  onChange={(e) => setSrc(e.target.value)}
                  onKeyDown={submitOnEnter(handleApply)}
                  aria-label="Image URL"
                  className="element-bar-input element-bar-grow"
                  disabled={busy}
                />
                {fileInput(imageFileRef)}
                {uploadButton(imageFileRef, 'Upload', 'Replace with an image from your computer')}
                <input
                  type="text"
                  value={alt}
                  onChange={(e) => setAlt(e.target.value)}
                  onKeyDown={submitOnEnter(handleApply)}
                  placeholder="Alt text"
                  aria-label="Alt text"
                  className="element-bar-input element-bar-alt"
                  disabled={isApplying}
                />
              </>
            )}

            {showLink && (
              <label className="element-bar-field element-bar-grow">
                <Link2 size={15} className="element-bar-field-icon" aria-hidden="true" />
                <input
                  type="text"
                  value={href}
                  onChange={(e) => setHref(e.target.value)}
                  onKeyDown={submitOnEnter(handleApply)}
                  placeholder="Link URL  https://…"
                  aria-label="Link URL"
                  className="element-bar-input element-bar-input-icon"
                  disabled={isApplying}
                />
              </label>
            )}

            {showBackground && (
              <>
                <span className="element-bar-label">Fill</span>
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(bgColor) ? bgColor : '#ffffff'}
                  onChange={(e) => setBgColor(e.target.value)}
                  disabled={isApplying}
                  className="element-bar-swatch"
                  aria-label="Pick background color"
                  title="Pick a background color"
                />
                <input
                  type="text"
                  value={bgColor}
                  onChange={(e) => {
                    const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                    setBgColor(v);
                  }}
                  onKeyDown={submitOnEnter(handleApply)}
                  aria-label="Background color hex"
                  spellCheck={false}
                  className="element-bar-input element-bar-hex"
                  disabled={isApplying}
                />
                <span className="chrome-divider element-bar-divider" aria-hidden="true" />
                <span className="element-bar-label">Wallpaper</span>
                {fileInput(bgFileRef)}
                {uploadButton(
                  bgFileRef,
                  bgImage ? 'Change' : 'Upload',
                  element.backgroundImage && !bgImage
                    ? 'Replace this background image (URL-based wallpapers go through Ask AI)'
                    : 'Set a background image from your computer',
                )}
                {bgImage && (
                  <span className="element-bar-ready">
                    <img src={bgImage} alt="" className="element-bar-thumb element-bar-thumb-sm" />
                    <Check size={13} aria-hidden="true" />
                    Ready
                    <button
                      type="button"
                      onClick={() => setBgImage('')}
                      className="element-bar-ready-clear"
                      aria-label="Discard uploaded wallpaper"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
              </>
            )}

            {isTextRole && !hasEditableFields && !message && (
              <p className="element-bar-hint">
                <Type size={14} className="shrink-0" aria-hidden="true" />
                <span>
                  {showLink
                    ? 'Double-click it on the page to edit its text in place'
                    : 'Click the text on the page to edit it in place'}
                </span>
              </p>
            )}

            {message && (
              <p className="element-bar-message" title={message}>
                <AlertTriangle size={14} className="shrink-0" />
                <span>{message}</span>
              </p>
            )}
          </>
        )}
      </div>

      {/* What you can do with it, quietest first; one filled key. */}
      <div className="element-bar-actions">
        {showAiInput ? (
          <>
            {hasEditableFields && !error && (
              <button
                type="button"
                onClick={() => setShowAiInput(false)}
                className="nav-btn nav-ghost nav-btn-icon element-bar-btn-icon"
                aria-label="Back to direct edits"
                data-tip="Back to direct edits"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={handleAiSend}
              className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs"
              data-tip="Prefill the chat with this element and your request"
              data-tip-align="end"
            >
              <Sparkles size={15} />
              <span>Send to chat</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowAiInput(true)}
              className="nav-btn nav-ghost element-bar-btn"
              data-tip="Describe the change and let AI make it"
            >
              <Wand2 size={15} />
              <span>Ask AI</span>
            </button>
            {hasEditableFields && (
              <button
                type="button"
                onClick={handleApply}
                disabled={busy}
                className="nav-btn brand-fill-text preview-key bg-brand hover:bg-brand-hover text-white border border-transparent shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                data-tip="Applied instantly and saved as a new version"
                data-tip-align="end"
              >
                {isApplying ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                <span>{isApplying ? 'Applying…' : 'Apply'}</span>
              </button>
            )}
          </>
        )}
        <span className="chrome-divider element-bar-divider" aria-hidden="true" />
        <button
          type="button"
          onClick={onCancel}
          className="nav-btn nav-ghost nav-btn-icon element-bar-btn-icon"
          aria-label="Close editor"
          data-tip="Close"
          data-tip-align="end"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
