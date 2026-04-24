// ESLint flat config. Minimal by design: we run this to catch the class of
// bug that `c is not defined` fell into (renamed local referenced by an old
// name inside a template literal). Style is not policed here.
import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  fetch: 'readonly', localStorage: 'readonly', history: 'readonly',
  location: 'readonly', atob: 'readonly', btoa: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  console: 'readonly', alert: 'readonly', CustomEvent: 'readonly',
  Uint8Array: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
  URLSearchParams: 'readonly', URL: 'readonly', CSS: 'readonly',
  marked: 'readonly', // CDN global used in markdown.js
};

const nodeTestGlobals = {
  process: 'readonly', Buffer: 'readonly',
  globalThis: 'writable',
};

export default [
  js.configs.recommended,

  // Browser source
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },

  // Node test suite
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...browserGlobals, ...nodeTestGlobals },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Ignore generated / third-party artefacts
  {
    ignores: ['node_modules/**', 'tests/fixtures/**'],
  },
];
