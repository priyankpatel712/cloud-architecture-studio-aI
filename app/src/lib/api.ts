import { NextResponse } from 'next/server';
import { z, type ZodType } from 'zod';
import { HttpError } from '@/lib/session';
import type { UserDoc } from '@/lib/models/User';

/** Map thrown errors (HttpError or unexpected) to a JSON response. */
export function fail(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error('[api] unexpected error:', e);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

/**
 * Parse + validate a JSON request body against a zod schema (research R10).
 * Throws HttpError(400) with a compact field summary so `fail()` produces the
 * shared validation error shape: { error: "field: message; ..." }.
 */
export async function parseBody<T extends ZodType>(req: Request, schema: T): Promise<z.output<T>> {
  const raw = await req.json().catch(() => ({}));
  const result = schema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new HttpError(400, summary);
  }
  return result.data;
}

export function serializeUser(u: UserDoc) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    organization: u.organization,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  };
}
