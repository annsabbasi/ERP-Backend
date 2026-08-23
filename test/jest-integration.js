/**
 * Integration suite config.
 *
 * A .js config rather than .json so the reasoning can live next to the setting
 * it explains — jest rejects unknown keys, so a JSON file has nowhere to put a
 * comment.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\.spec\.ts$',
  transform: { '^.+\.(t|j)s$': 'ts-jest' },
  testTimeout: 120000,
  // One worker on purpose. The suites share a database and a demo company, and
  // several assert on a ledger balance before and after an operation. Run in
  // parallel they would read each other's postings as their own and fail in
  // ways that look like real defects.
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/test/integration/jest.setup.ts'],
};
