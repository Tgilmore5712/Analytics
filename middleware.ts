import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { resolvePermissionForPath } from '@/lib/permissions';
import {
  getPermissionCookieOptions,
  PERMISSION_COOKIE_NAME,
  verifyPermissionCookieValue,
} from '@/lib/permissionCookie';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimit';
import {
  DIAGNOSTICS_OR_TEST_API_ROUTES,
  DIAGNOSTICS_OR_TEST_PAGE_ROUTES,
  matchesDiagnosticsOrTestRoute,
  shouldBlockDiagnosticsInProduction,
} from '@/lib/diagnosticsGate';

const API_RATE_LIMIT = 300;
const API_RATE_WINDOW_MS = 60 * 1000;
const INTERNAL_PERMISSION_CHECK_ROUTE = '/api/internal/permission-check';

type PermissionCheckResult = {
  allowed: boolean;
  permissionsCookie?: string | null;
};

function resolvePermissionsForRequest(request: NextRequest): string[] {
  const { pathname, searchParams } = request.nextUrl;
  const method = request.method.toUpperCase();
  const permissions = new Set<string>();
  const defaultPermission = resolvePermissionForPath(pathname);

  if (defaultPermission) {
    permissions.add(defaultPermission);
  }

  if (method === 'GET') {
    if (pathname === '/api/projects' && searchParams.get('mode') === 'dashboard') {
      permissions.add('kpi');
    }

    if (pathname === '/api/scheduling' || pathname === '/api/scheduling/projects-with-budget') {
      permissions.add('kpi');
    }

    if (pathname === '/api/short-term-schedule' && searchParams.get('action') === 'active-schedule') {
      permissions.add('kpi');
    }
  }

  return Array.from(permissions);
}

function applyPermissionCookie(response: NextResponse, cookieValue: string | null) {
  if (cookieValue) {
    response.cookies.set(PERMISSION_COOKIE_NAME, cookieValue, getPermissionCookieOptions());
  }

  return response;
}

async function checkDatabasePermission(request: NextRequest, permissions: string[]): Promise<PermissionCheckResult> {
  try {
    const cookie = request.headers.get('cookie');
    const response = await fetch(new URL(INTERNAL_PERMISSION_CHECK_ROUTE, request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ permissions }),
      cache: 'no-store',
    });

    if (!response.ok) return { allowed: false };
    const data = await response.json().catch(() => null) as {
      allowed?: unknown;
      permissionsCookie?: unknown;
    } | null;

    return {
      allowed: data?.allowed === true,
      permissionsCookie: typeof data?.permissionsCookie === 'string' ? data.permissionsCookie : null,
    };
  } catch (error) {
    console.error('Failed to check route permission:', error);
    return { allowed: false };
  }
}

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldBlockDiagnostics = shouldBlockDiagnosticsInProduction();
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0ClientId = (process.env.AUTH0_CLIENT_ID || '').trim();
  const auth0Secret = (process.env.AUTH0_SECRET || '').trim();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain') ||
    !auth0ClientId ||
    !auth0Secret;

  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');
  const isAuthApiRoute = pathname.startsWith('/api/auth/');
  const isInternalPermissionCheckRoute = pathname === INTERNAL_PERMISSION_CHECK_ROUTE;
  const isPublicVersionRoute = pathname === '/api/public/version';
  const isDiagnosticsOrTestApiRoute = matchesDiagnosticsOrTestRoute(
    pathname,
    DIAGNOSTICS_OR_TEST_API_ROUTES
  );
  const isDiagnosticsOrTestPageRoute = matchesDiagnosticsOrTestRoute(
    pathname,
    DIAGNOSTICS_OR_TEST_PAGE_ROUTES
  );

  if (shouldBlockDiagnostics && isDiagnosticsOrTestApiRoute) {
    return NextResponse.json(
      { success: false, error: 'Not found' },
      { status: 404 }
    );
  }

  if (shouldBlockDiagnostics && isDiagnosticsOrTestPageRoute) {
    return new NextResponse('Not found', { status: 404 });
  }

  // In dev mode without Auth0 config, bypass all middleware
  if (isDev && auth0Misconfigured) {
    return NextResponse.next();
  }

  // In production or if Auth0 is configured, enforce auth
  if (isPublicVersionRoute) {
    return NextResponse.next();
  }

  if (isInternalPermissionCheckRoute) {
    return NextResponse.next();
  }

  // Allow auth routes
  if (isAuthApiRoute) {
    const response = await auth0.middleware(request);
    return response;
  }

  let apiRateLimit:
    | ReturnType<typeof checkRateLimit>
    | null = null;

  if (isApiRoute) {
    const clientId = getClientIdentifier(request.headers);
    apiRateLimit = checkRateLimit({
      key: `${clientId}:${pathname}`,
      limit: API_RATE_LIMIT,
      windowMs: API_RATE_WINDOW_MS,
    });

    if (apiRateLimit.limited) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(apiRateLimit.retryAfter),
            'X-RateLimit-Limit': String(apiRateLimit.limit),
            'X-RateLimit-Remaining': String(apiRateLimit.remaining),
            'X-RateLimit-Reset': String(Math.floor(apiRateLimit.resetAt / 1000)),
          },
        }
      );
    }
  }

  // Allow login page
  if (pathname === '/login') {
    return NextResponse.next();
  }

  if (pathname === '/forbidden') {
    return NextResponse.next();
  }

  // Allow login handoff page (used to break out of iframe before Auth0 redirect)
  if (pathname === '/auth/start') {
    return NextResponse.next();
  }

  const session = await auth0.getSession(request);
  if (!session) {
    if (isApiRoute) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', request.url);
    const returnTo = `${pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(loginUrl);
  }

  let permissionCookieToSet: string | null = null;
  const requiredPermissions = resolvePermissionsForRequest(request);
  if (requiredPermissions.length > 0) {
    const sessionEmail = session.user?.email?.trim().toLowerCase() || null;
    const cachedPermissions = await verifyPermissionCookieValue(
      request.cookies.get(PERMISSION_COOKIE_NAME)?.value,
      sessionEmail
    );
    const cachedAllowed = cachedPermissions?.permissions.some(
      (permission) => requiredPermissions.some((requiredPermission) => permission.toLowerCase() === requiredPermission.toLowerCase())
    ) === true;
    const permissionCheck = cachedAllowed
      ? { allowed: true, permissionsCookie: null }
      : await checkDatabasePermission(request, requiredPermissions);
    const allowed = permissionCheck.allowed;
    permissionCookieToSet = permissionCheck.permissionsCookie || null;

    if (!allowed) {
      if (isApiRoute) {
        return NextResponse.json(
          { success: false, error: 'Forbidden' },
          { status: 403 }
        );
      }

      const forbiddenUrl = new URL('/forbidden', request.url);
      forbiddenUrl.searchParams.set('from', `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(forbiddenUrl);
    }
  }

  if (isApiRoute && apiRateLimit) {
    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(apiRateLimit.limit));
    response.headers.set('X-RateLimit-Remaining', String(apiRateLimit.remaining));
    response.headers.set('X-RateLimit-Reset', String(Math.floor(apiRateLimit.resetAt / 1000)));
    return applyPermissionCookie(response, permissionCookieToSet);
  }

  return applyPermissionCookie(await auth0.middleware(request), permissionCookieToSet);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
