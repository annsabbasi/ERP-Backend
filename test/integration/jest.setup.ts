import { assertDisposableDatabase } from './harness';

// Fail before a single test runs rather than partway through, so a suite
// pointed at the wrong database never gets to write anything.
assertDisposableDatabase();
