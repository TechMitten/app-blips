import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ExternalLink, ImagePlus, Images, Loader2, Search } from 'lucide-react';
import { ConfirmedLink } from './ExternalLinkConfirm';
import Modal from './Modal';
import { FIELD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import { safeStorage } from '../lib/config';
import { MAX_GALLERY_IMAGES } from '../lib/galleryImages';
import { downloadPixabayImage, searchPixabay } from '../lib/pixabay';

// Set once the user has dismissed the "where do these go" note, so it only
// shows the first time they ever pick a photo.
const INTRO_SEEN_KEY = 'orion-pixabay-intro-seen';

const introSeen = () => {
  try {
    return safeStorage('local')?.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

// Shown on the first photo pick: picked photos go to My images, and the AI
// uses them from there. Portaled out of the settings card, whose overflow
// would clip a fixed overlay.
function PixabayIntroModal({ onClose }) {
  return createPortal(
    <Modal
      zIndex={70}
      cardClass="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-scale-in"
      cardProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'pixabay-intro-title',
        onKeyDown: (event) => { if (event.key === 'Escape') onClose(); },
      }}
    >
      <div className="p-6 space-y-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
          <Images size={20} aria-hidden="true" />
        </span>
        <h2 id="pixabay-intro-title" className="text-base font-semibold text-slate-900">Your photos go to My images</h2>
        <p className="text-sm leading-snug text-slate-700">
          When you click <strong>Add to My images</strong>, the photos you selected are added to the <strong>My images</strong> connector,
          the image library of the project you have open.
        </p>
        <p className="text-sm leading-snug text-slate-700">
          Each photo gets a name there, such as <strong>mountain-lake-sunset</strong>. To use a specific photo,
          mention its name to the AI, for example <em>“use mountain-lake-sunset as the hero background”</em>.
          You can also ask for all of them at once: <em>“put all my images in a gallery”</em>.
        </p>
      </div>
      <div className="flex justify-end bg-slate-50 px-6 py-4">
        <button type="button" onClick={onClose} autoFocus className={PRIMARY_BUTTON}>Got it!</button>
      </div>
    </Modal>,
    document.body,
  );
}

// Search Pixabay and add the picked photos to the open project's My images
// (useImageGallery's addFiles, through `galleryProject`). Shown on the Pixabay
// connector page and on the My images page. Thumbnails load straight from
// Pixabay's CDN, as its API terms allow for showing results; the photos
// themselves are downloaded through the server (pixabayApi.js) and stored
// like uploads, never linked. Pixabay asks for a visible credit wherever
// results are shown, hence the "Photos from Pixabay" line.
export default function PixabaySearch({ galleryProject, imagesEnabled, onEnableImages }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // { q, page, totalHits, hits }
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(() => new Map());
  const [progress, setProgress] = useState(null); // { done, total }
  const [message, setMessage] = useState(null); // { done: string[], errors: string[] }
  const [introOpen, setIntroOpen] = useState(false);

  if (!galleryProject) {
    return (
      <p className="py-4 text-sm leading-snug text-slate-600">
        Open or start a project first. Photos you add go into that project’s My images.
      </p>
    );
  }

  const room = Math.max(0, MAX_GALLERY_IMAGES - galleryProject.images.length);

  const run = async (q, page) => {
    setSearching(true);
    setMessage(null);
    const result = await searchPixabay(q, page);
    setSearching(false);
    if (result.error) {
      setMessage({ done: [], errors: [result.error] });
      return;
    }
    setResults((current) => ({
      q,
      page,
      totalHits: result.totalHits,
      // "Load more" appends; a page can repeat a photo, so ids are de-duplicated.
      hits: page > 1 && current
        ? [...current.hits, ...result.hits.filter((hit) => !current.hits.some((old) => old.id === hit.id))]
        : result.hits,
    }));
    if (page === 1) setSelected(new Map());
  };

  const closeIntro = () => {
    setIntroOpen(false);
    try {
      safeStorage('local')?.setItem(INTRO_SEEN_KEY, '1');
    } catch { /* storage blocked: it may show again next time */ }
  };

  const toggle = (hit) => {
    if (!selected.has(hit.id) && !introSeen()) setIntroOpen(true);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(hit.id)) next.delete(hit.id);
      else if (next.size < room) next.set(hit.id, hit);
      return next;
    });
  };

  const add = async () => {
    const picks = [...selected.values()];
    if (!picks.length) return;
    setMessage(null);
    const files = [];
    const notes = [];
    const errors = [];
    for (const [index, hit] of picks.entries()) {
      setProgress({ done: index, total: picks.length });
      const result = await downloadPixabayImage(hit);
      if (result.error) errors.push(result.error);
      else {
        files.push(result.file);
        notes.push(result.note);
      }
    }
    setProgress({ done: picks.length, total: picks.length });
    const { added, errors: addErrors } = files.length ? await galleryProject.onAddFiles(files, { notes }) : { added: 0, errors: [] };
    setProgress(null);
    setSelected(new Map());
    const done = [];
    if (added) done.push(`Added ${added} photo${added === 1 ? '' : 's'} to My images. To use one, mention its name (shown under it in My images) to the AI.`);
    if (files.length > added + addErrors.length) done.push('Some of them were already in My images.');
    if (added && !imagesEnabled) {
      onEnableImages?.();
      done.push('My images was switched on so the AI can use them.');
    }
    // The same error for every photo is said once.
    setMessage({ done, errors: [...new Set([...errors, ...addErrors])] });
  };

  const busy = searching || progress !== null;
  const hasMore = results && results.hits.length < Math.min(results.totalHits, 500);

  return (
    <div className="space-y-3 py-4">
      <form
        role="search"
        onSubmit={(event) => { event.preventDefault(); run(query, 1); }}
        className="flex gap-2"
      >
        <label htmlFor="pixabay-query" className="sr-only">Search Pixabay photos</label>
        <input
          id="pixabay-query"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search free photos, e.g. mountain lake"
          maxLength={100}
          className={FIELD_CLASS}
        />
        <button type="submit" className={SECONDARY_BUTTON} disabled={busy}>
          {searching ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
          Search
        </button>
      </form>
      <p className="text-xs text-slate-500">
        <ConfirmedLink href="https://pixabay.com/" why="To visit Pixabay, where these free photos come from." className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
          Photos from Pixabay<ExternalLink size={11} aria-hidden="true" />
        </ConfirmedLink>
        {' '}· free to use under the Pixabay Content License.
      </p>

      {results && (results.hits.length === 0
        ? <p className="text-sm text-slate-500">No photos found{results.q ? ` for “${results.q}”` : ''}. Try other words.</p>
        : (
          <>
            <p className="text-xs text-slate-600" aria-live="polite">
              {room === 0
                ? `My images is full (${MAX_GALLERY_IMAGES} images). Remove some to add more.`
                : `Click the photos you want (up to ${room} more). ${selected.size} selected.`}
            </p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {results.hits.map((hit) => {
                const isSelected = selected.has(hit.id);
                const label = hit.tags || `Pixabay photo ${hit.id}`;
                return (
                  <li key={hit.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => toggle(hit)}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? 'Unselect' : 'Select'} photo: ${label}`}
                      disabled={busy || (!isSelected && selected.size >= room)}
                      className={`relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-100 ring-offset-2 transition-shadow disabled:cursor-not-allowed ${isSelected ? 'ring-2 ring-indigo-500' : 'hover:ring-2 hover:ring-slate-300'}`}
                    >
                      <img
                        src={hit.previewURL || hit.webformatURL}
                        srcSet={hit.previewURL && hit.webformatURL ? `${hit.previewURL} 150w, ${hit.webformatURL} 640w` : undefined}
                        sizes="(min-width: 640px) 200px, 45vw"
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                      {isSelected && (
                        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow">
                          <Check size={14} aria-hidden="true" />
                        </span>
                      )}
                    </button>
                    <p className="mt-1 truncate text-[11px] text-slate-500" title={label}>
                      {hit.pageURL && hit.user
                        ? <ConfirmedLink href={hit.pageURL} why={`To see this photo by ${hit.user} on Pixabay.`} className="hover:underline">by {hit.user}</ConfirmedLink>
                        : label}
                    </p>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button type="button" className={SECONDARY_BUTTON} onClick={() => run(results.q, results.page + 1)} disabled={busy}>
                {searching && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Load more
              </button>
            )}
          </>
        ))}

      {results?.hits.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
          <button type="button" className={PRIMARY_BUTTON} onClick={add} disabled={busy || selected.size === 0}>
            {progress ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
            {selected.size > 0 ? `Add ${selected.size} to My images` : 'Add to My images'}
          </button>
          {progress && (
            <span role="status" className="text-xs text-slate-600">
              {progress.done < progress.total ? `Downloading ${progress.done + 1} of ${progress.total}…` : 'Saving…'}
            </span>
          )}
        </div>
      )}

      {message?.done.length > 0 && (
        <ul role="status" className="space-y-1 text-sm text-emerald-700">
          {message.done.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {introOpen && <PixabayIntroModal onClose={closeIntro} />}
      {message?.errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-red-600">
          {message.errors.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}
