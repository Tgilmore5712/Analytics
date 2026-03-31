import { NextRequest } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';

function isSafeReturnToPath(value: string | null): value is string {
  if (!value) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('/api/auth')) return false;
  if (value === '/login' || value.startsWith('/login?')) return false;
  if (value === '/auth/start' || value.startsWith('/auth/start?')) return false;
  if (value === '/auth/complete' || value.startsWith('/auth/complete?')) return false;
  return true;
}

function normalizeAuthRequest(request: NextRequest): NextRequest {
  const url = new URL(request.url);

  // Preserve explicit returnTo path for deep-link refresh/login flows.
  if (url.pathname.endsWith('/api/auth/login')) {
    const requestedReturnTo = url.searchParams.get('returnTo');

    if (isSafeReturnToPath(requestedReturnTo)) {
      url.searchParams.set('returnTo', requestedReturnTo);
      return new NextRequest(url, request);
    }

    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.origin === url.origin) {
          const fallbackReturnTo = `${refererUrl.pathname}${refererUrl.search}`;
          if (isSafeReturnToPath(fallbackReturnTo)) {
            url.searchParams.set('returnTo', fallbackReturnTo);
            return new NextRequest(url, request);
          }
        }
      } catch {
        // Ignore invalid referer values.
      }
    }

    url.searchParams.set('returnTo', '/');
    return new NextRequest(url, request);
  }

  return request;
}

export async function GET(request: NextRequest) {
  const auth0 = createAuth0Client(request.nextUrl.origin);
  return auth0.middleware(normalizeAuthRequest(request));
}

export async function POST(request: NextRequest) {
  const auth0 = createAuth0Client(request.nextUrl.origin);
  return auth0.middleware(normalizeAuthRequest(request));
}
