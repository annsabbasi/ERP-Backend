import { defineConfig } from 'tsup';

// Dual output like @erp/contracts: the NestJS apps load CommonJS. The generated Prisma
// client (src/generated) is bundled in; `shims` gives its import.meta.url a CommonJS stand-in.
// seed and local-roles-cli run as `node dist/<name>.js` from this package.
export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts', 'src/seed.ts', 'src/local-roles-cli.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: ['src/index.ts', 'src/testing.ts'] },
  shims: true,
  clean: true,
});
