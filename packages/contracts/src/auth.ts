import { z } from 'zod';

// Sign-in, sessions and account security (Part 05 §5.3–5.4, Part 10 §10.6, Part 11 §11.10.2),
// shared by the API, the web app, the Platform Console and the desktop app.

// ── Password policy (§5.4, NIST SP 800-63B-4) ──────────────────────────────────────────────

export const PASSWORD_POLICY = {
  /** A password used as the only factor. */
  minWithoutMfa: 15,
  /** A password used with MFA. A company may require more. */
  minWithMfa: 8,
  /** At least 64 must be accepted; the cap only bounds hashing work. */
  max: 256,
} as const;

/**
 * Passwords are compared in NFKC form, so the same password typed on different keyboards
 * (full-width digits, composed accents) matches. Length is counted in characters, not bytes.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export type PasswordRuleKey = 'length' | 'max_length' | 'not_email' | 'not_company' | 'not_common';

export type PasswordRule = { key: PasswordRuleKey; ok: boolean; min?: number; max?: number };

export type PasswordContext = {
  /** The account uses MFA, so the shorter minimum applies. */
  mfa: boolean;
  email?: string;
  companyName?: string;
};

/**
 * The live checklist (§5.3.1 step 2). No composition rules. The common-password check needs
 * the server's list, so it is added there (`not_common`); the client shows it after saving.
 */
export function checkPassword(password: string, context: PasswordContext): PasswordRule[] {
  const value = normalizePassword(password);
  const lower = value.toLowerCase();
  const length = [...value].length;
  const min = context.mfa ? PASSWORD_POLICY.minWithMfa : PASSWORD_POLICY.minWithoutMfa;
  const local = context.email?.split('@')[0]?.toLowerCase() ?? '';
  const company = context.companyName?.toLowerCase().replace(/\s+/g, '') ?? '';
  return [
    { key: 'length', ok: length >= min, min },
    { key: 'max_length', ok: length <= PASSWORD_POLICY.max, max: PASSWORD_POLICY.max },
    {
      key: 'not_email',
      ok: !context.email || (local.length < 3 ? true : !lower.includes(local)),
    },
    {
      key: 'not_company',
      ok: company.length < 3 || !lower.replace(/\s+/g, '').includes(company),
    },
  ];
}

// ── Shared fields ──────────────────────────────────────────────────────────────────────

export const EmailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ error: 'Enter a valid e-mail address' }));

/** Accepted for sign-in as typed; the policy applies only when a password is set. */
const PasswordInput = z.string().min(1).max(1024);
const TotpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const RecoveryCode = z.string().trim().min(8).max(32);
const Opaque = z.string().min(16).max(512);

// ── Tokens and memberships ─────────────────────────────────────────────────────────────

export const AUDIENCES = ['app', 'console'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Claims of an access token (§10.6). `mid`, `tid` and `pv` only once a company is chosen. */
export type AccessTokenClaims = {
  sub: string;
  sid: string;
  aud: Audience;
  iss: string;
  iat: number;
  exp: number;
  amr: string[];
  mid?: string;
  tid?: string;
  pv?: number;
};

export const MembershipSummarySchema = z.object({
  membership_id: z.uuid(),
  tenant_id: z.uuid(),
  tenant_code: z.string(),
  tenant_slug: z.string(),
  tenant_name: z.string(),
  display_name: z.string(),
  kind: z.string(),
});
export type MembershipSummary = z.infer<typeof MembershipSummarySchema>;

export const SignedInSchema = z.object({
  status: z.literal('signed_in'),
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expires_in: z.number().int(),
  /** Desktop only: the main process keeps it; the web app gets an httpOnly cookie instead. */
  refresh_token: z.string().optional(),
  /** The company the token is for, or null until one is chosen (/auth/switch). */
  membership: MembershipSummarySchema.nullable(),
  memberships: z.array(MembershipSummarySchema),
});
export type SignedIn = z.infer<typeof SignedInSchema>;

export const MfaRequiredSchema = z.object({
  status: z.literal('mfa_required'),
  challenge: z.string(),
  methods: z.array(z.enum(['totp', 'recovery_code'])),
});

/** Staff signing in for the first time enrol an authenticator before anything else (D5). */
export const MfaEnrolmentRequiredSchema = z.object({
  status: z.literal('mfa_enrolment_required'),
  challenge: z.string(),
  secret: z.string(),
  otpauth_uri: z.string(),
});

export const LoginResponseSchema = z.discriminatedUnion('status', [
  SignedInSchema,
  MfaRequiredSchema,
  MfaEnrolmentRequiredSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ── Requests ───────────────────────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordInput,
  /** A random id the browser or desktop keeps, to notice sign-ins from a new device. */
  device_id: z.string().min(16).max(128).optional(),
});

export const MfaVerifyRequestSchema = z
  .object({ challenge: Opaque, code: TotpCode.optional(), recovery_code: RecoveryCode.optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recovery_code), {
    error: 'Send either the code or a recovery code',
    path: ['code'],
  });

export const MfaEnrolConfirmRequestSchema = z.object({ challenge: Opaque, code: TotpCode });

export const RefreshRequestSchema = z.object({ refresh_token: Opaque.optional() });

export const SwitchRequestSchema = z.object({ membership_id: z.uuid() });

export const ForgotPasswordRequestSchema = z.object({ email: EmailSchema });

export const ResetPasswordRequestSchema = z.object({ token: Opaque, password: PasswordInput });

export const ChangePasswordRequestSchema = z.object({
  current_password: PasswordInput,
  new_password: PasswordInput,
});

export const StepUpRequestSchema = z
  .object({ code: TotpCode.optional(), recovery_code: RecoveryCode.optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.recovery_code), {
    error: 'Send either the code or a recovery code',
    path: ['code'],
  });

export const TotpConfirmRequestSchema = z.object({ code: TotpCode });

export const EmailChangeRequestSchema = z.object({
  new_email: EmailSchema,
  password: PasswordInput,
});

export const LinkTokenRequestSchema = z.object({ token: Opaque });

export const StaffSetupRequestSchema = z.object({ token: Opaque, password: PasswordInput });

// ── Responses ──────────────────────────────────────────────────────────────────────────

/** Same body whether or not the address has an account (§5.3.7). */
export const AcceptedSchema = z.object({ status: z.literal('accepted') });

export const DoneSchema = z.object({ status: z.literal('done') });

export const MeSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  locale: z.string(),
  mfa: z.object({
    enrolled: z.boolean(),
    /** A company or the Owner role requires MFA, so it cannot be turned off. */
    required: z.boolean(),
  }),
  /** The password is long enough to be used without MFA (gap G16). */
  password_single_factor_ok: z.boolean(),
  membership_id: z.uuid().nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export const MembershipsSchema = z.object({ data: z.array(MembershipSummarySchema) });

export const SessionSummarySchema = z.object({
  id: z.uuid(),
  client: z.enum(['web', 'desktop']),
  user_agent: z.string().nullable(),
  ip: z.string().nullable(),
  created_at: z.iso.datetime(),
  last_seen_at: z.iso.datetime(),
  current: z.boolean(),
});
export const SessionsSchema = z.object({ data: z.array(SessionSummarySchema) });

export const TotpEnrolmentSchema = z.object({ secret: z.string(), otpauth_uri: z.string() });

export const RecoveryCodesSchema = z.object({ recovery_codes: z.array(z.string()) });

/** Staff confirm their first authenticator and get their recovery codes with the tokens. */
export const StaffEnrolledSchema = SignedInSchema.extend({ recovery_codes: z.array(z.string()) });

export const StaffMeSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
});

export const StaffSetupInfoSchema = z.object({ email: z.string(), name: z.string() });

/** The public signing keys, so other services can verify access tokens. */
export const JwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())) });
