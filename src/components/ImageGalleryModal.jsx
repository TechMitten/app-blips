import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Images, Loader2, Trash2, X } from 'lucide-react';
import Modal from './Modal';
import ConfirmModal from './ConfirmModal';
import { FIELD_CLASS, PRIMARY_BUTTON } from './SettingControls';
import { blobBytes } from '../lib/blobStore';
import { MAX_GALLERY_IMAGES, MAX_GALLERY_NOTE, galleryPath } from '../lib/galleryImages';

const stemOf = (name) => name.replace(/\.[a-z0-9]+$/i, '');
const extOf = (name) => name.slice(name.lastIndexOf('.'));

function formatSize(bytes) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// One gallery image: thumbnail, editable name (the path pages use) and note
// (what the AI is told it shows).
function GalleryTile({ image, url, inUse, disabled, onRename, onNote, onRemove }) {
  const [stem, setStem] = useState(stemOf(image.name));
  const [note, setNote] = useState(image.note || '');

  const commitStem = () => {
    if (stem.trim() && stem !== stemOf(image.name)) setStem(stemOf(onRename(image.name, stem)));
    else setStem(stemOf(image.name));
  };
  const commitNote = () => {
    if (note !== (image.note || '')) onNote(image.name, note);
  };

  const size = image.type === 'image/svg+xml' ? 'SVG' : [image.width && image.height ? `${image.width}×${image.height}` : '', formatSize(image.size)].filter(Boolean).join(' · ');
  return (
    <li className="rounded-xl border border-slate-200 overflow-hidden flex flex-col bg-surface">
      <div className="relative aspect-[4/3] bg-slate-100 flex items-center justify-center">
        {url
          ? <img src={url} alt={image.note || image.name} className="w-full h-full object-contain" />
          : <span className="text-xs text-slate-500 px-3 text-center">Image missing on this device</span>}
        {inUse && (
          <span className="absolute top-2 left-2 rounded-full bg-surface/90 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            In use
          </span>
        )}
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
        <label className="block">
          <span className="sr-only">Name</span>
          <span className="flex items-center gap-1">
            <input
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              onBlur={commitStem}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={disabled}
              maxLength={40}
              className={`${FIELD_CLASS} py-1! px-2! font-medium`}
              aria-label={`Name of ${image.name}`}
            />
            <span className="text-xs text-slate-500 shrink-0">{extOf(image.name)}</span>
          </span>
        </label>
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

// "My images": the project's uploaded images (lib/galleryImages.js). Same
// shell as Settings. Uploads are processed and stored by useImageGallery.
export default function ImageGalleryModal({ images, bytesVersion, usedNames, isGenerating, onAddFiles, onRename, onNote, onRemove, onClose }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(null);

  // Thumbnails from the stored bytes; revoked when the list changes or the
  // modal closes.
  const urls = useMemo(() => {
    const out = {};
    for (const image of images) {
      const bytes = blobBytes(image.hash);
      if (bytes) out[image.hash] = URL.createObjectURL(new Blob([bytes], { type: image.type }));
    }
    return out;
    // bytesVersion: stored bytes finished loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, bytesVersion]);
  useEffect(() => () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url)), [urls]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !removing && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, removing]);

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
    <Modal
      zIndex={60}
      cardClass="w-full max-w-lg sm:max-w-2xl xl:max-w-3xl max-h-[90vh] bg-surface rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in flex flex-col"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'gallery-title' }}
    >
      <div className="shrink-0 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h2 id="gallery-title" className="text-xl font-bold text-slate-900">My images</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center text-center gap-3 transition-colors ${dragging ? 'border-brand bg-slate-50' : 'border-slate-300'}`}
        >
          <Images size={28} className="text-slate-400" aria-hidden="true" />
          <p className="text-sm text-slate-700">
            Add your own photos, logos and pictures. Then ask the AI to use them, for example
            {' '}<em>"put team-photo in the hero"</em> or <em>"use all my images"</em>.
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
              The AI sees each image's name and note, not the picture itself, so a short note helps it pick the right one.
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
                  onRemove={confirmRemove}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-slate-500 text-center">No images yet.</p>
        )}
      </div>

      {removing && (
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
        </ConfirmModal>
      )}
    </Modal>
  );
}
