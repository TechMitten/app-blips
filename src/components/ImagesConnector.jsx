import { useState } from 'react';
import { Camera, ChevronUp } from 'lucide-react';
import { SettingRow, Switch, SECONDARY_BUTTON } from './SettingControls';
import ImageGallery from './ImageGallery';
import PixabaySearch from './PixabaySearch';

// Settings → Tools → My images. The switch is global (it decides whether
// the AI hears about any image). The gallery belongs to the open project
// (App.jsx owns the bytes through useImageGallery), so it sits right on this
// page, where each image can also be hidden from the AI. With the Pixabay
// connector set up, its photo search opens here too; otherwise a link points
// to its page.
export default function ImagesConnector({ state, onChange, galleryProject, pixabayConnected = false, onOpenPixabay }) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <>
      <SettingRow
        id="set-images"
        title="Enable My images"
        description="Let the AI use the images you add to the project you have open. Turn it off and the AI ignores all of them."
      >
        <Switch checked={state.enabled} onChange={(enabled) => onChange({ enabled })} labelledBy="set-images" />
      </SettingRow>
      {galleryProject
        ? (
          <div>
            {!state.enabled && galleryProject.images.length > 0 && (
              <p className="pt-4 text-xs leading-snug text-slate-600">The AI ignores your images while My images is off.</p>
            )}
            <div className="pt-4">
              {pixabayConnected
                ? (
                  <button
                    type="button"
                    onClick={() => setSearchOpen((open) => !open)}
                    aria-expanded={searchOpen}
                    aria-controls="images-pixabay-search"
                    className={SECONDARY_BUTTON}
                  >
                    {searchOpen ? <ChevronUp size={14} aria-hidden="true" /> : <Camera size={14} aria-hidden="true" />}
                    {searchOpen ? 'Close Pixabay search' : 'Find free photos on Pixabay'}
                  </button>
                )
                : (
                  <p className="text-xs leading-snug text-slate-600">
                    Want free stock photos?{' '}
                    <button type="button" onClick={onOpenPixabay} className="font-semibold text-indigo-600 hover:underline">
                      Set up the Pixabay connector
                    </button>
                    {' '}to search them from here.
                  </p>
                )}
              {pixabayConnected && searchOpen && (
                <div id="images-pixabay-search">
                  <PixabaySearch
                    galleryProject={galleryProject}
                    imagesEnabled={state.enabled}
                    onEnableImages={() => onChange({ enabled: true })}
                  />
                </div>
              )}
            </div>
            <ImageGallery {...galleryProject} />
          </div>
        )
        : (
          <p className="py-4 text-sm leading-snug text-slate-600">
            Open or start a project first. The images belong to one project, so each can have its own.
          </p>
        )}
    </>
  );
}
