import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Eye, EyeOff, ImagePlus, Images, Loader2, Trash2 } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { FIELD_CLASS, PRIMARY_BUTTON } from './SettingControls';
import useGalleryThumbnails from '../hooks/useGalleryThumbnails';
import { MAX_GALLERY_IMAGES, MAX_GALLERY_NOTE, galleryPath } from '../lib/galleryImages';

const stemOf = (name) => name.replace(/\.[a-z0-9]+$/i, '');
const extOf = (name) => name.slice(name.lastIndexOf('.'));

function formatSize(bytes) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// One gallery image: thumbnail, editable name (the path pages use) and note
// (what the AI is told it shows). The name is how users point the AI at one
// image, so it copies with one click (a long name can be cut off in the box).
function GalleryTile({ image, url, inUse, disabled, onRename, onNote, onToggle, onRemove }) {
  const [stem, setStem] = useState(stemOf(image.name));
  const [note, setNote] = useState(image.note || '');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Copies the saved name (with its extension), not an unsaved edit. When the
  // clipboard is blocked, the name is selected so the user can copy it.
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(image.name);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopyFailed(true);
      nameRef.current?.select();
    }
  };

  const commitStem = () => {
    if (stem.trim() && stem !== stemOf(image.name)) setStem(stemOf(onRename(image.name, stem)));
    else setStem(stemOf(image.name));
  };
  const commitNote = () => {
    if (note !== (image.note || '')) onNote(image.name, note);
  };

  const visible = image.enabled !== false;
  const size = image.type === 'image/svg+xml' ? 'SVG' : [image.width && image.height ? `${image.width}×${image.height}` : '', formatSize(image.size)].filter(Boolean).join(' · ');
  return (
    <li className="rounded-xl border border-slate-200 overflow-hidden flex flex-col bg-surface">
      <div className="relative aspect-[4/3] bg-slate-100 flex items-center justify-center">
        {url
          ? <img src={url} alt={image.note || image.name} className={`w-full h-full object-contain${visible ? '' : ' opacity-40 grayscale'}`} />
          : <span className="text-xs text-slate-500 px-3 text-center">Image missing on this device</span>}
        {inUse && (
          <span className="absolute top-2 left-2 rounded-full bg-surface/90 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            In use
          </span>
        )}
        {!visible && (
          <span className="absolute bottom-2 left-2 rounded-full bg-surface/90 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            Hidden from the AI
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggle(image.name, !visible)}
          aria-pressed={!visible}
          aria-label={visible ? `Hide ${image.name} from the AI` : `Show ${image.name} to the AI`}
          title={visible ? 'Hide from the AI' : 'Show to the AI'}
          className="absolute top-2 right-12 p-1.5 rounded-lg bg-surface/90 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
        >
          {visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onRemove(image)}
          disabled={disabled}
          aria-label={`Remove ${image.name}`}
          title="Remove"
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-surface/90 border border-slate-200 text-slate-600 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="p-3 space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor={`gallery-name-${image.hash}`} className="text-[11px] font-semibold text-slate-600">Name</label>
            <button
              type="button"
              onClick={copyName}
              aria-label={copied ? `Copied ${image.name}` : `Copy the name ${image.name}`}
              title="Copy the name to use in a prompt"
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
                copied ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'text-indigo-600 hover:bg-indigo-500/10'
              }`}
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy name'}
            </button>
          </div>
          <span className="flex items-center gap-1">
            <input
              id={`gallery-name-${image.hash}`}
              ref={nameRef}
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              onBlur={commitStem}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={disabled}
              maxLength={40}
              spellCheck={false}
              title={image.name}
              className={`${FIELD_CLASS} py-1! px-2! font-medium`}
            />
            <span className="text-xs text-slate-500 shrink-0">{extOf(image.name)}</span>
          </span>
          {copyFailed && (
            <p role="alert" className="mt-1 text-[11px] text-red-600">Couldn’t copy. The name is selected: press Ctrl+C (Cmd+C on a Mac).</p>
          )}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          maxLength={MAX_GALLERY_NOTE}
          rows={2}
          placeholder="What is it? e.g. our team at the summer party"
          aria-label={`Note about ${image.name}`}
          className={`${FIELD_CLASS} py-1.5! px-2! text-xs resize-none`}
        />
        <p className="text-[11px] text-slate-500">{size}</p>
      </div>
    </li>
  );
}

// "My images": the project's uploaded images (lib/galleryImages.js), shown
// inside Settings → Tools → My images (ImagesConnector.jsx). Uploads are
// processed and stored by useImageGallery.
export default function ImageGallery({ images, bytesVersion, usedNames, isGenerating, onAddFiles, onRename, onNote, onToggle, onRemove }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(null);

  const urls = useGalleryThumbnails(images, bytesVersion);

  const add = async (fileList) => {
    const files = [...(fileList || [])].filter((file) => file.type?.startsWith('image/'));
    if (!files.length || busy) return;
    setBusy(true);
    setErrors([]);
    const result = await onAddFiles(files);
    setBusy(false);
    setErrors(result.errors);
  };

  useEffect(() => {
    const onPaste = (event) => {
      const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      add(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const full = images.length >= MAX_GALLERY_IMAGES;
  const confirmRemove = (image) => {
    if (usedNames.has(image.name)) setRemoving(image);
    else onRemove(image.name);
  };

  return (
    <>
      <div className="space-y-5 py-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center text-center gap-3 transition-colors ${dragging ? 'border-brand bg-slate-50' : 'border-slate-300'}`}
        >
          <Images size={28} className="text-slate-400" aria-hidden="true" />
          <p className="text-sm text-slate-700">
            Add your own photos, logos and pictures. To use a specific image, mention its name to the AI,
            for example <em>"put team-photo in the hero"</em>. Or ask for all of them: <em>"use all my images"</em>.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            multiple
            className="hidden"
            onChange={(e) => { add(e.target.files); e.target.value = ''; }}
          />
          <button type="button" className={PRIMARY_BUTTON} onClick={() => inputRef.current?.click()} disabled={busy || full}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
            {busy ? 'Adding…' : 'Upload images'}
          </button>
          <p className="text-xs text-slate-500">
            Drag and drop or paste works too. JPEG, PNG, WebP, GIF or SVG, up to {MAX_GALLERY_IMAGES} images. Big photos are resized to 2000 pixels.
          </p>
        </div>

        {errors.length > 0 && (
          <ul role="alert" className="text-sm text-red-600 space-y-1">
            {errors.map((message, i) => <li key={i}>{message}</li>)}
          </ul>
        )}

        {images.length > 0 ? (
          <>
            <p className="text-xs text-slate-500">
              To use an image, mention its name to the AI: click Copy name on it and paste the name into your request. The AI sees each image's name and note, not the picture itself, so a short note helps it when you don't name one. Click the eye to hide an image from the AI; pages that already show it keep showing it.
              {isGenerating && ' Names can be changed once the build has finished.'}
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {images.map((image) => (
                <GalleryTile
                  key={image.hash}
                  image={image}
                  url={urls[image.hash]}
                  inUse={usedNames.has(image.name)}
                  disabled={isGenerating}
                  onRename={onRename}
                  onNote={onNote}
                  onToggle={onToggle}
                  onRemove={confirmRemove}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-slate-500 text-center">No images yet.</p>
        )}
      </div>

      {removing && createPortal(
        <ConfirmModal
          title="Remove this image?"
          onClose={() => setRemoving(null)}
          onConfirm={() => { onRemove(removing.name); setRemoving(null); }}
          confirmLabel="Remove"
          confirmClass="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <p className="text-sm text-slate-700">
            Your project uses <strong>{galleryPath(removing)}</strong>. After removing it, that spot shows a broken image until you ask the AI to change it.
          </p>
        </ConfirmModal>,
        document.body,
      )}
    </>
  );
}
