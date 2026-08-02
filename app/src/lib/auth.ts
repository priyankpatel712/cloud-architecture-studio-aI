import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@/lib/rbac';

export const SESSION_COOKIE = 'cas_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  sub: string; // user id
  email: string;
  name: string;
  role: Role;
  /** email verified — the workspace gate (FR-004); false corrals the session to /verify */
  verified: boolean;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return new TextEncoder().encode(s);
}

// ---- passwords (Node runtime) ----
// Cost factor 12 (~2026 baseline). Configurable so it can track hardware without
// a code change; clamped to a sane range.
const BCRYPT_ROUNDS = Math.min(15, Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10) || 12));
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---- tokens (edge-compatible via jose) ----
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role, verified: payload.verified })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.role) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role as Role,
      // Sessions issued before the verification gate carry no claim; treat them as
      // verified — they predate the gate and new sign-ins re-evaluate it.
      verified: payload.verified === undefined ? true : Boolean(payload.verified),
    };
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};
