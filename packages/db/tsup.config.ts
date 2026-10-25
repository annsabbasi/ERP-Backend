import { defineConfig } from 'tsup';

// Dual output like @erp/contracts: the NestJS apps load CommonJS. The seed runs as
// `node dist/seed.js` from this package.
export default defineConfig({
  entry: ['src/index.ts', 'src/seed.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  clean: true,
});
