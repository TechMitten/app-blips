import { useEffect, useMemo, useRef } from 'react';
import { blobBytes } from '../lib/blobStore';

// Thumbnail URLs for My images pictures, from their stored bytes:
// { [hash]: blob URL }, missing while an image's bytes haven't loaded
// (`bytesVersion` changes when they do). Used by the gallery and by the
// AI's image confirmation in the chat. Revoked when the list changes or the
// component goes away. Revoking waits a tick and skips URLs that are back in
// use: StrictMode unmounts and remounts at once with the same memoized URLs,
// and revoking those straight away showed every image as broken.
export default function useGalleryThumbnails(images, bytesVersion) {
  const urls = useMemo(() => {
    const out = {};
    for (const image of images || []) {
      const bytes = blobBytes(image.hash);
      if (bytes) out[image.hash] = URL.createObjectURL(new Blob([bytes], { type: image.type }));
    }
    return out;
    // bytesVersion: stored bytes finished loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, bytesVersion]);
  const liveUrls = useRef(null);
  useEffect(() => {
    liveUrls.current = urls;
    return () => {
      liveUrls.current = null;
      setTimeout(() => {
        if (liveUrls.current !== urls) Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
      }, 0);
    };
  }, [urls]);
  return urls;
}
