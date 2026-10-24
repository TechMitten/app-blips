import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blobBytes, cacheBlobs, ensureBlobs, putBlobs } from '../lib/blobStore';
import { isDesktop } from '../lib/desktop';
import {
  MAX_GALLERY_BYTES, MAX_GALLERY_IMAGES, MAX_GALLERY_NOTE, galleryBytesTotal, galleryDataUrl, galleryName,
  processGalleryUpload, renamedGalleryName, setActiveGallery,
} from '../lib/galleryImages';
import { logError } from '../lib/errorLog';

// The project's "My images" gallery (lib/galleryImages.js). The list lives in
// App state (useProjects saves and loads it with the project row); this hook
// adds uploads, edits, the stored bytes and the URLs the preview loads them
// from. Uploads made before the project has an id stay in the blob cache
// until its first save stores them (useProjects saveProject).
export default function useImageGallery({ images, setImages, projectId, saveProject, onRenamed }) {
  // Bumped when stored bytes arrive, so thumbnails and the browser preview's
  // data: URLs re-render.
  const [bytesVersion, setBytesVersion] = useState(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    setActiveGallery(images);
  }, [images]);

  // The project whose images are known to be on disk/in IndexedDB: uploads
  // held in memory are stored once it has an id (putBlobs skips stored ones),
  // and saved images are loaded into memory.
  const [storedProjectId, setStoredProjectId] = useState(null);
  const hashKey = images.map((image) => image.hash).join(',');
  useEffect(() => {
    if (!projectId || !hashKey) return;
    let cancelled = false;
    const hashes = hashKey.split(',');
    const held = new Map(hashes.map((hash) => [hash, blobBytes(hash)]).filter(([, bytes]) => bytes));
    putBlobs(projectId, held)
      .then(() => ensureBlobs(projectId, hashes))
      .then(() => {
        if (cancelled) return;
        setStoredProjectId(projectId);
        setBytesVersion((n) => n + 1);
      })
      .catch((err) => logError(`Could not load the images of project ${projectId}`, err));
    return () => { cancelled = true; };
  }, [projectId, hashKey]);

  // A project with an id saves straight away; a new one keeps the list in
  // state until its first build saves it.
  const commit = useCallback((next) => {
    imagesRef.current = next;
    setImages(next);
    if (projectId) saveProject({ imagesToSave: next, force: true });
  }, [projectId, saveProject, setImages]);

  // -> { added: number, errors: string[] }
  const addFiles = useCallback(async (fileList) => {
    const files = [...(fileList || [])];
    const errors = [];
    let next = imagesRef.current;
    for (const file of files) {
      if (next.length >= MAX_GALLERY_IMAGES) {
        errors.push(`A project can have at most ${MAX_GALLERY_IMAGES} images.`);
        break;
      }
      try {
        const processed = await processGalleryUpload(file);
        if (next.some((image) => image.hash === processed.hash)) continue;
        if (galleryBytesTotal(next) + processed.bytes.length > MAX_GALLERY_BYTES) {
          errors.push(`${file.name} doesn't fit: a project's images can be at most ${MAX_GALLERY_BYTES / 1024 / 1024} MB in total.`);
          continue;
        }
        cacheBlobs(new Map([[processed.hash, processed.bytes]]));
        if (projectId) await putBlobs(projectId, new Map([[processed.hash, processed.bytes]]));
        next = [...next, {
          hash: processed.hash,
          name: galleryName(file.name, processed.type, next.map((image) => image.name)),
          type: processed.type,
          width: processed.width,
          height: processed.height,
          size: processed.bytes.length,
          note: '',
        }];
      } catch (err) {
        errors.push(err?.message || `${file.name} couldn't be added.`);
      }
    }
    const added = next.length - imagesRef.current.length;
    if (added) {
      commit(next);
      setBytesVersion((n) => n + 1);
    }
    return { added, errors };
  }, [commit, projectId]);

  const setNote = useCallback((name, note) => {
    commit(imagesRef.current.map((image) => (image.name === name ? { ...image, note: String(note).slice(0, MAX_GALLERY_NOTE) } : image)));
  }, [commit]);

  // Renaming changes the path pages use, so App rewrites them (onRenamed).
  // Returns the final name (made unique and valid).
  const rename = useCallback((name, newStem) => {
    const image = imagesRef.current.find((item) => item.name === name);
    if (!image) return name;
    const newName = renamedGalleryName(image, newStem, imagesRef.current.map((item) => item.name));
    if (newName === name) return name;
    const next = imagesRef.current.map((item) => (item.name === name ? { ...item, name: newName } : item));
    commit(next);
    onRenamed?.(name, newName, next);
    return newName;
  }, [commit, onRenamed]);

  const remove = useCallback((name) => {
    commit(imagesRef.current.filter((image) => image.name !== name));
  }, [commit]);

  // URL the sandboxed preview loads an image from: the desktop app serves
  // stored blobs from appblips://assets (electron/main.js serveAsset);
  // elsewhere, and before the project is first saved, the bytes go inline.
  const servedFrom = isDesktop && projectId && storedProjectId === projectId ? projectId : null;
  const inlineVersion = servedFrom ? 0 : bytesVersion;
  const toUrl = useCallback((image) => {
    const ext = image.name.slice(image.name.lastIndexOf('.') + 1);
    if (servedFrom) return `appblips://assets/${servedFrom}/${image.hash}.${ext}`;
    const bytes = blobBytes(image.hash);
    return bytes ? galleryDataUrl(image, bytes) : '';
    // inlineVersion: data: URLs appear once the bytes have loaded (desktop
    // URLs don't wait for them, so loading doesn't reload the preview there).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servedFrom, inlineVersion]);

  const previewGallery = useMemo(
    () => (images.length ? { images, toUrl } : undefined),
    [images, toUrl],
  );

  return { addFiles, setNote, rename, remove, previewGallery, bytesVersion };
}
