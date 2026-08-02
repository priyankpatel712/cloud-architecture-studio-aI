import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  await clearSession();
  const url = new URL(req.url);
  return NextResponse.redirect(new URL('/login', url.origin));
}
