import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalFilesystemAdapter } from './local-filesystem.adapter';
import { S3Adapter } from './s3.adapter';
import { ObjectStorageAdapter } from './storage.types';

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

/**
 * The storage adapter is chosen at boot from `STORAGE_DRIVER`. We instantiate
 * the concrete adapter via a factory so the ObjectStorageAdapter injection
 * token is stable across drivers.
 */
const adapterProvider: Provider = {
  provide: STORAGE_ADAPTER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ObjectStorageAdapter => {
    const driver = config.get<string>('storage.driver', 'local');
    if (driver === 's3') return new S3Adapter(config);
    return new LocalFilesystemAdapter(config);
  },
};

@Module({
  providers: [adapterProvider, LocalFilesystemAdapter, S3Adapter],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
