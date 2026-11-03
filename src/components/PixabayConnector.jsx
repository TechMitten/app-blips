import ServerKeyConnector from './ServerKeyConnector';
import PixabaySearch from './PixabaySearch';
import { forgetPixabayKey, pixabayStatus, savePixabayKey } from '../lib/pixabay';

const PIXABAY_API = { status: pixabayStatus, save: savePixabayKey, forget: forgetPixabayKey };

// Settings → Extensions → Pixabay: the shared server-key page
// (ServerKeyConnector.jsx), plus the photo search once connected.
export default function PixabayConnector({ state, onChange, galleryProject, imagesEnabled, onEnableImages }) {
  return (
    <ServerKeyConnector id="pixabay" api={PIXABAY_API} state={state} onChange={onChange}>
      <div>
        <h4 className="pt-4 text-sm font-semibold text-slate-900">Find photos</h4>
        <PixabaySearch galleryProject={galleryProject} imagesEnabled={imagesEnabled} onEnableImages={onEnableImages} />
      </div>
    </ServerKeyConnector>
  );
}
