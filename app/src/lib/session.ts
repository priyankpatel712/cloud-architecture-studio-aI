import 'server-only';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  cookieOptions,
  signSession,
  verifySession,
  type SessionPayload,
} from '@/lib/auth';
import { can, type Permission } from '@/lib/rbac';

/** Read + verify the current session from the request cookie (server only). */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions);
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
}

/** Thrown by the require* helpers; route handlers map it to a 401/403. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Not authenticated');
  return s;
}

export async function requireCan(permission: Permission): Promise<SessionPayload> {
  const s = await requireSession();
  if (!can(s.role, permission)) throw new HttpError(403, 'Insufficient permissions');
  return s;
}

/**
 * Workspace APIs (projects, chat, pricing, connections, export) additionally require
 * a verified email (FR-004 gate). Auth endpoints keep using requireSession.
 */
export async function requireVerified(): Promise<SessionPayload> {
  const s = await requireSession();
  if (!s.verified) throw new HttpError(403, 'Please verify your email to continue.');
  return s;
}
