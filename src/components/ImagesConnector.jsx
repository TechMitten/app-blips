import { SettingRow, Switch } from './SettingControls';
import ImageGallery from './ImageGallery';

// Settings → Connectors → My images. The switch is global (it decides whether
// the AI hears about any image). The gallery belongs to the open project
// (App.jsx owns the bytes through useImageGallery), so it sits right on this
// page, where each image can also be hidden from the AI.
export default function ImagesConnector({ state, onChange, galleryProject }) {
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
