import crypto from 'crypto';
import { get, getClientIp, run } from './db';

export type AdminSessionScope = 'admin' | 'mail' | 'dev';

type SessionRow = {
  token_hash: string;
  scope: AdminSessionScope;
  expires_at: number;
};

const COOKIE_NAMES: Record<AdminSessionScope, string> = {
  admin: 'uliuli_admin_session',
  mail: 'uliuli_mail_session',
  dev: 'uliuli_dev_session',
};

const SESSION_TTL_MS: Record<AdminSessionScope, number> = {
  admin: 7 * 24 * 60 * 60_000,
  mail: 7 * 24 * 60 * 60_000,
  dev: 12 * 60 * 60_000,
};

export function getSessionCookieName(scope: AdminSessionScope): string {
  return COOKIE_NAMES[scope];
}

export function getExpectedPassword(scope: AdminSessionScope): string | null {
  if (scope === 'admin') return process.env.ADMIN_PASSWORD?.trim() || null;
  if (scope === 'dev') return process.env.DEV_UNLOCK_PASSWORD?.trim() || null;

  const mailPassword = process.env.MAIL_AUTH_PASSWORD?.trim();
  if (mailPassword) return mailPassword;
  return process.env.ADMIN_PASSWORD?.trim() || null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, Buffer.alloc(ab.length));
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  const parts = raw.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export async function createAdminSession(
  scope: AdminSessionScope,
  req: Request,
): Promise<{ token: string; maxAge: number }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS[scope];
  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') ?? '';

  await run('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
  await run(
    `INSERT INTO admin_sessions
       (token_hash, scope, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hashToken(token), scope, now, expiresAt, now, ip, userAgent],
  );

  return { token, maxAge: Math.floor(SESSION_TTL_MS[scope] / 1000) };
}

export async function verifyAdminSession(
  req: Request,
  scope: AdminSessionScope,
): Promise<boolean> {
  const token = parseCookie(req, COOKIE_NAMES[scope]);
  if (!token) return false;

  const now = Date.now();
  const row = await get<SessionRow>(
    `SELECT token_hash, scope, expires_at
     FROM admin_sessions
     WHERE token_hash = ? AND scope = ?`,
    [hashToken(token), scope],
  );

  if (!row || row.expires_at <= now) {
    await run('DELETE FROM admin_sessions WHERE token_hash = ?', [hashToken(token)]).catch(() => {});
    return false;
  }

  await run(
    'UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?',
    [now, row.token_hash],
  ).catch(() => {});
  return true;
}

export async function destroyAdminSession(
  req: Request,
  scope: AdminSessionScope,
): Promise<void> {
  const token = parseCookie(req, COOKIE_NAMES[scope]);
  if (!token) return;
  await run('DELETE FROM admin_sessions WHERE token_hash = ? AND scope = ?', [
    hashToken(token),
    scope,
  ]);
}

export function sessionCookieOptions(scope: AdminSessionScope, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function expiredSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
}
