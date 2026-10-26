// Shared ESLint flat configs. Each app or package re-exports one of these
// from its own eslint.config.mjs.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Build tools write temporary config bundles beside their configs while they run (tsup:
// *.bundled_*.mjs, Vite: *.timestamp-*.mjs); a lint running at the same time must skip them.
const ignores = {
  ignores: [
    '**/dist/**',
    '**/release/**',
    '**/coverage/**',
    '**/generated/**',
    '**/.turbo/**',
    '**/*.bundled_*.mjs',
    '**/*.timestamp-*.mjs',
  ],
};

/** TypeScript on Node: api, worker, desktop main process, libraries. */
export const node = tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
  },
);

/** React in the browser: web, console, ui. */
export const react = tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
);

export default node;
