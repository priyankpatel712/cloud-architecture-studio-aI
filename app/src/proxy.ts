import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { isAdminRole } from '@/lib/rbac';

/**
 * Edge proxy (Next 16's replacement for "middleware"). Gates the whole app:
 *  - unauthenticated visitors are sent to /login (with a ?next back-link)
 *  - authenticated visitors on an auth page are sent to their home
 *  - /admin additionally requires an admin-tier role
 * Uses jose only (no mongoose) so it runs on the edge runtime. API routes
 * self-guard and are passed through untouched.
 */
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let API routes handle their own auth (they return JSON, not redirects).
  if (pathname.startsWith('/api')) return NextResponse.next();

  if (pathname === '/logout') {
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const isAuthPage = AUTH_PAGES.includes(pathname);

  // /verify is reachable without a session (emailed link opens in any browser);
  // the page itself sends unauthenticated visitors without a token to /login.
  if (pathname === '/verify') {
    if (session?.verified) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  }

  // 007 1.3 — public share links: /share/<token> is world-readable by design
  // (the unguessable token IS the credential; the API resolves and scopes it).
  if (pathname.startsWith('/share/')) return NextResponse.next();

  if (!session) {
    if (isAuthPage) return NextResponse.next();
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Email-verification gate (FR-004): an unverified session is corralled to /verify
  // until the emailed link is confirmed — no workspace or admin access before that.
  if (!session.verified) {
    if (pathname === '/forgot-password' || pathname === '/reset-password') {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/verify', req.url));
  }

  // Signed in: keep them out of the auth pages.
  if (isAuthPage) {
    return NextResponse.redirect(new URL(isAdminRole(session.role) ? '/admin' : '/', req.url));
  }

  // Admin area requires an admin-tier role.
  if (pathname.startsWith('/admin') && !isAdminRole(session.role)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static files (anything with a dot).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
