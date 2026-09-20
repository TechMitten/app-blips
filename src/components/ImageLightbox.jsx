import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Full-size view of an attached screenshot/image. Click the backdrop, press
// Escape, or use the close button to dismiss.
export default function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      className="fixed inset-0 bg-scrim backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 cursor-zoom-out animate-fade-in"
      style={{ zIndex: 80 }}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg shadow-xl bg-white"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image preview"
        className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white cursor-pointer"
      >
        <X size={18} />
      </button>
    </div>,
    document.body
  );
}
