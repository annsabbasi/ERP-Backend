/**
 * Object-storage adapter contract.
 *
 *   • `put` stores a byte buffer at `key`, returning the resulting size and
 *     SHA-256 hex checksum. The caller (DocumentsService) is responsible for
 *     constructing tenant-scoped keys — see TENANT_PREFIX below.
 *   • `get` returns the full byte buffer. Streaming variants can be added
 *     later for very large files.
 *   • `signedUrl` is best-effort: the local adapter returns null (no signing
 *     possible), while S3 / R2 / MinIO can return presigned URLs so the
 *     client downloads directly.
 *
 * Errors propagate; the documents service wraps them and audits the failure.
 */
export interface PutResult {
  size: number;
  checksum: string;
}

export interface ObjectStorageAdapter {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, mimeType: string): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, expiresInSec: number): Promise<string | null>;
}

/**
 * Canonical storage key pattern. Every key starts with the tenant prefix so
 * a misrouted SDK call cannot reach another tenant's bytes.
 */
export function storageKeyFor(companyId: string, documentId: string, versionId: string): string {
  return `companies/${companyId}/documents/${documentId}/${versionId}`;
}
