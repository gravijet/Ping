// Flat ESLint config for the Ping server + the vanilla-JS web client.
// Goal: catch *bugs* (not style — Prettier owns formatting, and
// eslint-config-prettier turns off the stylistic rules that would clash).
// Three environments: Node (src/, scripts/, tests), the browser (webclient),
// and the service worker (webclient/sw.js).
import js from '@eslint/js';
import globals from 'globals';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import security from 'eslint-plugin-security';
import prettier from 'eslint-config-prettier';

// Bug-catching rules layered on top of eslint:recommended. Everything here is
// about correctness, never formatting.
const bugRules = {
  eqeqeq: ['error', 'smart'], // allows the `== null` nullish idiom
  // Unused vars are hygiene, not bugs — surface them as warnings so a real bug
  // (a wrong/dead variable) is visible without the legacy backlog blocking CI.
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-self-compare': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-template-curly-in-string': 'warn',
  // High false-positive rate in single-threaded JS (mostly `obj.prop = await …`).
  // Genuine re-entrancy is reviewed by hand (calls/voice). Warn, don't block.
  'require-atomic-updates': 'warn',
  'no-unreachable-loop': 'error',
  'no-constructor-return': 'error',
  'array-callback-return': 'error',
  'no-await-in-loop': 'off', // intentional in sequential sweeps
  'default-case-last': 'error',
  // Empty `catch {}` is a deliberate "best effort" idiom across the client.
  'no-empty': ['error', { allowEmptyCatch: true }],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      // Compiled Flutter web build (main.dart.js, canvaskit, flutter.js) — a
      // gitignored artifact, not source.
      'public/webapp/**',
      'public/downloads/**',
      'public/webclient/vendor/**',
    ],
  },

  js.configs.recommended,

  // ---- Node side: src/, scripts/, config -----------------------------------
  {
    files: ['src/**/*.js', 'scripts/**/*.{js,mjs}', '*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { security },
    rules: {
      ...bugRules,
      // Security heuristics that are high-signal for this server. The noisy
      // object-injection / non-literal-fs rules are intentionally left off:
      // we legitimately index objects by key and build fs paths from random ids.
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-child-process': 'error',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
    },
  },

  // ---- Tests: Node + the node:test globals ---------------------------------
  {
    files: ['test/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...bugRules },
  },

  // ---- Web client: browser ES modules --------------------------------------
  {
    files: ['public/webclient/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'no-unsanitized': nounsanitized },
    rules: {
      ...bugRules,
      // The XSS net: flag any `.innerHTML = …` / insertAdjacentHTML with a
      // non-literal. The one sanctioned sink is ui.js `{html}` (escaped there).
      'no-unsanitized/property': 'error',
      'no-unsanitized/method': 'error',
    },
  },

  // ---- Marketing site: a classic browser script (no modules) ---------------
  {
    files: ['public/site.js', 'public/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: { ...bugRules },
  },

  // ---- Service worker: its own globals -------------------------------------
  {
    files: ['public/webclient/sw.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  prettier,
];
