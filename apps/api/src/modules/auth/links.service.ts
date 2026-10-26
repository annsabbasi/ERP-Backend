import { Injectable } from '@nestjs/common';
import { ProblemException } from '../../common/problem';
import type { AccountStore } from './account-store';
import { randomToken, sha256 } from './crypto';

// One-time links (§10.6): 32 random bytes, only the SHA-256 stored, single use, an expiry,
// and a new link for the same person and purpose ends the older ones. Members: password
// resets, lockout and first-password links; staff: setup and reset links.

export type LinkKind = 'reset' | 'lockout' | 'setup';

@Injectable()
export class LinksService {
  /** Issues a link token valid for `minutes`; returns the raw token for the e-mail. */
  async issue(
    store: AccountStore,
    userId: string,
    kind: LinkKind,
    minutes: number,
  ): Promise<string> {
    const now = new Date();
    await store.t.linkToken.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    const raw = randomToken();
    await store.t.linkToken.create({
      data: {
        userId,
        kind,
        tokenHash: sha256(raw),
        expiresAt: new Date(now.getTime() + minutes * 60_000),
      },
    });
    return raw;
  }

  /** The link if it is unused, unexpired and of one of `kinds`; else 400 link_invalid. */
  async peek(store: AccountStore, raw: string, kinds: LinkKind[]) {
    const row = await store.t.linkToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= new Date() ||
      !kinds.includes(row.kind as LinkKind)
    ) {
      throw new ProblemException('link_invalid');
    }
    return row;
  }

  /** Uses the link up; of two requests with the same link only one succeeds. */
  async consume(store: AccountStore, id: string): Promise<void> {
    const used = await store.t.linkToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) throw new ProblemException('link_invalid');
  }
}
