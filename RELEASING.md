# Releasing a desktop update

## Quick checklist

- [ ] 1. Build and test the AppImage
- [ ] 2. Bump the version
- [ ] 3. Push a tag
- [ ] 4. Publish the draft release

Nothing reaches users until step 4.

---

## 1. Build and test

**On the VPS**, build it:
```bash
npm run lint            # optional: catch code problems first
npm run desktop:dist    # makes the AppImage + .deb in dist-desktop/
```

**On your PC**, copy it over and run it:
```bash
scp rayb@<vps-ip>:~/projects/app-blips/dist-desktop/AppBlips-*.AppImage .
chmod +x AppBlips-*.AppImage && ./AppBlips-*.AppImage
```

**Check that:**
- The app opens and your projects are still there
- Building an app works and the preview shows it
- Any errors show up in the terminal you started it from

## 2. Bump the version

```bash
npm version patch --no-git-tag-version    # or: minor / major
git commit -am "v0.1.1"
git push
```

## 3. Push a tag

The tag must match the version in `package.json`, with a `v` in front.

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub then builds everything (Actions → **Desktop**) and makes a **draft** release with:
- Windows `.exe`
- Linux `.AppImage` and `.deb`
- `latest*.yml` files (the auto-updater reads these)

## 4. Publish

GitHub → **Releases** → open the draft → add notes → **Publish release**.

Users get the update now:

| Install type | What happens |
|---|---|
| Windows installer, AppImage | Downloads in the background, offers **Restart to update** |
| .deb, source, Docker | Shows a notice with a link; they update by hand |

---

## When something goes wrong

| Problem | What to do |
|---|---|
| `npm run desktop` on the VPS fails with a `chrome-sandbox` / SIGTRAP error | Normal. The VPS has no screen. Test on your PC instead. |
| GitHub build failed | Fix it, then delete the tag and push it again (see below). Delete the old draft release too. |
| Released something broken | Release a new, higher version. Apps never go back to an older one. |
| Ubuntu 24.04+ user says the AppImage won't open (sandbox error) | Tell them to use the `.deb` instead. |

**Redo a tag:**
```bash
git tag -d v0.1.1 && git push origin :refs/tags/v0.1.1
git tag v0.1.1 && git push origin v0.1.1
```

## Good to know

- **Windows test build:** the VPS can't build the `.exe`. Use GitHub → Actions → Desktop → **Run workflow**, then download it from that run's artifacts. This doesn't release anything.
- **Auto-update can't be tested early.** It only sees published releases.
- **Your PC won't show the Ubuntu 24.04+ sandbox error.** Use a stock Ubuntu 24.04 VM to see what those users get.
- **`npm run build` isn't needed.** `npm run desktop:dist` does the whole build itself.
