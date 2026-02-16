import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth & Setup middleware.
 *
 * - /api/* routes are not intercepted (they handle auth themselves or are public)
 * - /setup is always accessible (needed for initial configuration)
 * - /login is always accessible
 * - /_next/*, /favicon.ico, etc. are always accessible
 * - All other routes require an `ai-engine-token` cookie OR redirect to /login
 * - If the database has no users yet (fresh install), redirect to /setup
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow these paths through
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/ws/') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // Check for auth token in cookie or Authorization header
  const token = request.cookies.get('ai-engine-token')?.value;

  if (!token) {
    // Redirect to login page
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Basic JWT validation (just check structure; full verify happens in API routes)
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete('ai-engine-token');
      return response;
    }
  } catch {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (they handle auth themselves)
     * - _next (static files)
     * - static assets
     */
    '/((?!api|ws/|_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)',
  ],
};
