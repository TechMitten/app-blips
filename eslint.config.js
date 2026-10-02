import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `android/` holds the Capacitor native project; its assets/public is a
  // minified copy of dist/ written by `cap sync`, not source we maintain.
  globalIgnores(['dist', 'dist-desktop', 'dist-electron', '.wrangler', 'android']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      // __APPBLIPS_VERSION__ is substituted by Vite's `define` (vite.config.js).
      globals: { ...globals.browser, __APPBLIPS_VERSION__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Lets ESLint see that <Component /> in JSX counts as using Component,
      // so unused imports/variables are caught without blanket exemptions.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': 'error',
    },
  },
  {
    files: ['vite.config.js', 'server.js', 'functions/**/*.js', 'testing/**/*.js', 'scripts/**/*.js', 'electron/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Sandboxed Electron preload: CommonJS with both browser and Node globals.
    files: ['electron/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
