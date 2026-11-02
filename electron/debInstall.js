// Is this a .deb install, and has it got the AppBlips apt source? The update
// notice uses this to tell people how to update: with the source, `apt
// upgrade` (or the software center) is the easy route; without it they
// install the downloaded .deb by hand. A .deb can't update itself, since that
// needs the user's password.
//
// A packaged Linux build that isn't running as an AppImage came from the .deb
// (the only other Linux target in electron-builder.yml). The source file is
// the one the installer writes (build/linux/after-install.tpl) and the docs
// tell people to create; .sources covers anyone who rewrote it in deb822 form.
// Checked on every call, since people add the source while the app is open.
import { existsSync } from 'node:fs';

export const APT_SOURCE_FILES = [
  '/etc/apt/sources.list.d/appblips.list',
  '/etc/apt/sources.list.d/appblips.sources',
];

export function debInstall({ isPackaged, platform = process.platform, env = process.env, exists = existsSync }) {
  if (!isPackaged || platform !== 'linux' || env.APPIMAGE) return null;
  let apt = false;
  try {
    apt = APT_SOURCE_FILES.some((file) => exists(file));
  } catch { /* unreadable: fall back to the download instructions */ }
  return { deb: true, apt };
}
