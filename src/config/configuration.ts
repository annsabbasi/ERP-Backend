export default () => ({
  port: parseInt(process.env.PORT ?? '3070', 10) || 3070,
  nodeEnv: process.env.NODE_ENV || 'development',

  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'secret',
    // Short-lived access token (Section 6.1).
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    // Refresh tokens are stored in DB (hashed); this is just the cookie/payload TTL.
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    // Legacy alias kept for backward compatibility while modules migrate.
    expiresIn: process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  },

  // Account lockout policy (Section 6.1 — IAM).
  auth: {
    maxFailedAttempts: parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS ?? '5', 10),
    lockoutMinutes: parseInt(process.env.AUTH_LOCKOUT_MINUTES ?? '15', 10),
    // Window over which failed attempts are counted before reset.
    failedAttemptWindowMinutes: parseInt(
      process.env.AUTH_FAILED_ATTEMPT_WINDOW_MINUTES ?? '15',
      10,
    ),
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },

  // Notifications (Section 6.10).
  notifications: {
    // SMTP — leave SMTP_HOST blank to disable email delivery (will log instead).
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || 'noreply@erp.local',
    },
    // Webhook delivery: max retries (with exponential backoff per attempt).
    webhooks: {
      maxAttempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '5', 10),
      timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
    },
  },

  // Object storage (Section 6.9).
  storage: {
    driver: (process.env.STORAGE_DRIVER || 'local') as 'local' | 's3',
    local: {
      // Base directory for the filesystem adapter. Resolved relative to CWD.
      basePath: process.env.STORAGE_LOCAL_PATH || './storage',
    },
    s3: {
      bucket: process.env.STORAGE_S3_BUCKET,
      region: process.env.STORAGE_S3_REGION,
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
    },
    // Upload size cap. Multer enforces this at request-parse time.
    maxUploadBytes: parseInt(
      process.env.STORAGE_MAX_UPLOAD_BYTES ?? String(50 * 1024 * 1024),
      10,
    ),
  },
});
