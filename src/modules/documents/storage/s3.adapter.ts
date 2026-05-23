import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageAdapter, PutResult } from './storage.types';

/**
 * S3-compatible storage adapter — scaffolded.
 *
 * The real implementation needs `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
 * We ship a stub that throws so misconfiguration is loud, rather than silent.
 * Switch `STORAGE_DRIVER=local` for now and install the SDK packages when
 * promoting this driver to production.
 */
@Injectable()
export class S3Adapter implements ObjectStorageAdapter {
  readonly driver = 's3' as const;
  private readonly logger = new Logger(S3Adapter.name);

  constructor(private readonly config: ConfigService) {
    if (!this.config.get<string>('storage.s3.bucket')) {
      this.logger.warn('S3 driver selected but STORAGE_S3_BUCKET is empty');
    }
  }

  async put(_key: string, _body: Buffer, _mimeType: string): Promise<PutResult> {
    throw new Error('S3Adapter not implemented yet — install @aws-sdk/client-s3 and wire up here');
  }

  async get(_key: string): Promise<Buffer> {
    throw new Error('S3Adapter not implemented yet');
  }

  async delete(_key: string): Promise<void> {
    throw new Error('S3Adapter not implemented yet');
  }

  async signedUrl(_key: string, _expiresInSec: number): Promise<string | null> {
    return null;
  }
}
