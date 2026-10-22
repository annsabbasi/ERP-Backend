import { defineConfig } from 'tsup';

// Dual output: the NestJS apps load CommonJS, the Vite apps load ES modules.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
});
