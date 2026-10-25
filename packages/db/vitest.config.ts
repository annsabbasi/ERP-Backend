import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Some tests start the Prisma CLI, which takes a few seconds on Windows.
    testTimeout: 60_000,
    // CI lists every test by name, so the isolation suite can be read off the run log.
    reporters: process.env.CI ? ['verbose'] : ['default'],
  },
});
