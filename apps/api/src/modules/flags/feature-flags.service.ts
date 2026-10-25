import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// Release flags (Part 03 §3.15): not entitlements, but switches that keep unfinished
// endpoints and screens hidden until their stage passes QA (ADR 0004).

const CACHE_MS = 30_000;

/**
 * FEATURE_FLAGS overrides the database for this process: "key=on,other=off". Values on,
 * true or 1 switch a flag on; anything else switches it off.
 */
export function parseFlagOverrides(value: string | undefined): Map<string, boolean> {
  const overrides = new Map<string, boolean>();
  for (const part of (value ?? '').split(',')) {
    const [key, state] = part.split('=').map((s) => s.trim());
    if (key) overrides.set(key, ['on', 'true', '1'].includes((state ?? '').toLowerCase()));
  }
  return overrides;
}

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private cache?: { at: number; flags: Map<string, boolean> };

  constructor(private readonly db: DatabaseService) {}

  /** Every known flag and whether it is on. Unknown flags are off. */
  async all(): Promise<Record<string, boolean>> {
    const flags = new Map(await this.fromDatabase());
    for (const [key, on] of parseFlagOverrides(process.env.FEATURE_FLAGS)) flags.set(key, on);
    return Object.fromEntries([...flags].sort(([a], [b]) => a.localeCompare(b)));
  }

  async isEnabled(key: string): Promise<boolean> {
    return (await this.all())[key] === true;
  }

  /** Clears the cache, for tests and after a flag is changed in the console. */
  reset(): void {
    this.cache = undefined;
  }

  private async fromDatabase(): Promise<Map<string, boolean>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.flags;
    try {
      const rows = await this.db.client.featureFlag.findMany({
        select: { key: true, enabled: true },
      });
      this.cache = { at: Date.now(), flags: new Map(rows.map((r) => [r.key, r.enabled])) };
    } catch (error) {
      // Fail closed: if the flags cannot be read, unfinished work stays hidden.
      this.logger.warn(`feature flags could not be read: ${(error as Error).message}`);
      return this.cache?.flags ?? new Map();
    }
    return this.cache.flags;
  }
}
