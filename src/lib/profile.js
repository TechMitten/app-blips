import { safeStorage } from './config.js';

// The user's name and chat avatar, chosen on the first onboarding slide.
// Single-user app, so it lives in this origin's localStorage with the other
// preferences (desktop: Electron's own profile folder).
export const PROFILE_KEY = 'orion-profile';

export const MAX_NAME_LENGTH = 40;

// Avatar id -> name read out by screen readers; the matching icons and
// colours are in components/ProfileAvatar.jsx.
export const AVATAR_LABELS = {
  rocket: 'Rocket', cat: 'Cat', dog: 'Dog', panda: 'Panda', rabbit: 'Rabbit', turtle: 'Turtle',
  bird: 'Bird', fish: 'Fish', ghost: 'Ghost', bot: 'Robot', pizza: 'Pizza', gamepad: 'Game controller',
};
export const AVATAR_IDS = Object.keys(AVATAR_LABELS);

export const cleanName = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);

// Anything unreadable or unknown falls back to "no profile", which shows the
// plain person icon as before.
export const loadProfile = () => {
  try {
    const saved = JSON.parse(safeStorage('local')?.getItem(PROFILE_KEY) || '{}');
    return {
      name: cleanName(saved?.name),
      avatar: AVATAR_IDS.includes(saved?.avatar) ? saved.avatar : '',
    };
  } catch {
    return { name: '', avatar: '' };
  }
};

export const saveProfile = ({ name, avatar }) => {
  const profile = { name: cleanName(name), avatar: AVATAR_IDS.includes(avatar) ? avatar : '' };
  safeStorage('local')?.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
};
