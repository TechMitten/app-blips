import { avatarGradient, avatarInitial } from '../../lib/galleryFormat';

// Generated avatar (there are no uploaded ones): the username's initial on a
// gradient hashed from the username, so a person looks the same everywhere.
export default function GalleryAvatar({ username, size = 32 }) {
  return (
    <span
      className="gallery-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: avatarGradient(username) }}
      aria-hidden="true"
    >
      {avatarInitial(username)}
    </span>
  );
}
