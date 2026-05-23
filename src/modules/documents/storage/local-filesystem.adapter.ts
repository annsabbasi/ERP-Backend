import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  ObjectStorageAdapter,
  PutResult,
} from './storage.types';

/**
 * Filesystem-backed storage adapter. Suitable for local development and
 * single-host deployments — production multi-host deployments should switch
 * to the S3 driver.
 *
 * Storage layout:
 *   <basePath>/companies/<companyId>/documents/<documentId>/<versionId>
 *
 * No signed URLs — `signedUrl()` returns null so callers stream via the
 * backend's download endpoint instead.
 */
@Injectable()
export class LocalFilesystemAdapter implements ObjectStorageAdapter {
  readonly driver = 'local' as const;
  private readonly logger = new Logger(LocalFilesystemAdapter.name);
  private readonly basePath: string;

  constructor(config: ConfigService) {
    this.basePath = path.resolve(config.get<string>('storage.local.basePath', './storage'));
  }

  async put(key: string, body: Buffer, _mimeType: string): Promise<PutResult> {
    const fullPath = this.resolveKey(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, body);

    const checksum = createHash('sha256').update(body).digest('hex');
    return { size: body.byteLength, checksum };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch (e) {
      // Idempotent — if the file is already gone, audit the inconsistency and move on.
      this.logger.warn(`delete miss for ${key}: ${(e as Error).message}`);
    }
  }

  async signedUrl(): Promise<string | null> {
    return null;
  }

  /** Defensively reject keys that try to escape the base path. */
  private resolveKey(key: string): string {
    const normalized = path.normalize(key).replace(/^[/\\]+/, '');
    const full = path.resolve(this.basePath, normalized);
    if (!full.startsWith(this.basePath + path.sep) && full !== this.basePath) {
      throw new Error(`Refusing to write outside storage root: ${key}`);
    }
    return full;
  }
}
