import type { Audience, SignedIn } from '@erp/contracts';
import type { Request, Response } from 'express';
import { ProblemException } from '../../common/problem';
import type { AuthConfig } from './auth.config';
import type { ClientMeta } from './sessions.service';

// Where the refresh token travels (§10.6). Web: an httpOnly, Secure, SameSite=Strict cookie
// scoped to the auth routes, never readable by the page. Desktop: the main process sends
// X-ERP-Client: desktop and keeps the token itself (safeStorage); the page never sees it.

const COOKIES: Record<Audience, { name: string; path: string }> = {
  app: { name: 'erp_rt', path: '/api/v1/auth' },
  console: { name: 'erp_staff_rt', path: '/api/platform/v1/auth' },
};

export function clientMeta(request: Request): ClientMeta {
  return {
    client: request.headers['x-erp-client'] === 'desktop' ? 'desktop' : 'web',
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/**
 * The refresh token of the request: the desktop sends it in the body; the web app's comes in
 * its cookie, accepted only from an allowed origin (CSRF, together with SameSite=Strict).
 */
export function refreshTokenOf(
  request: Request,
  audience: Audience,
  config: AuthConfig,
  bodyToken?: string,
): string | undefined {
  if (bodyToken) return bodyToken;
  const cookie = (request.cookies as Record<string, string> | undefined)?.[COOKIES[audience].name];
  if (!cookie) return undefined;
  const origin = request.headers.origin;
  if (!origin || !config.origins.includes(origin)) {
    throw new ProblemException(
      'permission_denied',
      'Requests with the sign-in cookie must come from the app',
    );
  }
  return cookie;
}

/** Sends the signed-in body; the refresh token goes in the body (desktop) or a cookie (web). */
export function deliver(
  request: Request,
  response: Response,
  audience: Audience,
  config: AuthConfig,
  body: SignedIn,
  refreshToken: string | undefined,
): SignedIn {
  if (!refreshToken) return body;
  if (clientMeta(request).client === 'desktop') return { ...body, refresh_token: refreshToken };
  response.cookie(COOKIES[audience].name, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: COOKIES[audience].path,
    domain: config.cookieDomain,
    maxAge: config.sessionDays * 86_400_000,
  });
  return body;
}

export function clearRefreshCookie(
  response: Response,
  audience: Audience,
  config: AuthConfig,
): void {
  response.clearCookie(COOKIES[audience].name, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: COOKIES[audience].path,
    domain: config.cookieDomain,
  });
}
