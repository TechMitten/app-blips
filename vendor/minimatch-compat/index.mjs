// See index.cjs. ESM consumers (glob 13+) import named exports; older ESM code
// may use the default import.
export * from 'minimatch-real'
export { minimatch as default } from 'minimatch-real'
