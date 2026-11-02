'use strict'
// minimatch 3/5 consumers (ESLint 9, eslint-plugin-react, electron-builder's
// asar/dir-compare, filelist) call require('minimatch') as a function; 9/10/11
// consumers use named exports. minimatch 11 only has the latter, so expose the
// patched function with every named export hung off it. No __esModule flag:
// TypeScript's __importDefault must hand back the function itself.
const real = require('minimatch-real')

module.exports = real.minimatch
for (const key of Object.keys(real)) module.exports[key] = real[key]
module.exports.default = real.minimatch
