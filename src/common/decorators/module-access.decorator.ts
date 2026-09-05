import { SetMetadata } from '@nestjs/common';

export const MODULE_ACCESS_KEY = 'requiredModule';

/**
 * Modules that may reach a route. Holding **any one** of them is enough.
 *
 * Usage: `@RequireModule('hr')` at controller class or handler level.
 * Enforced by ModuleAccessGuard against the user's `enabledModuleSlugs`.
 *
 * Several slugs are accepted because a few screens genuinely belong to two
 * modules at once. Exchange Rates & Indexes is the case that forced it: the
 * window lives under Administration and its two tabs read from
 * `/financials/exchange-rates` and `/administration/indexes`, so gating the
 * first on `financials` alone left a company that had Administration but not
 * Financials with one working tab and one that answered 403 — a half-broken
 * window rather than an absent one.
 */
export const RequireModule = (...slugs: string[]) => SetMetadata(MODULE_ACCESS_KEY, slugs);
