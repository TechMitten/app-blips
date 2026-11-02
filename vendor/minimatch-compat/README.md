# minimatch-compat

`package.json` overrides every `minimatch` in the dependency tree with this
folder. It is minimatch 11 (the first version with the fix for
GHSA-g3hv-75wg-m249, which was never backported) plus the old callable export
that ESLint 9, eslint-plugin-react and electron-builder still rely on.

Remove it (and the `minimatch` override) once `npm ls minimatch` shows nothing
asking for a version below 11.
