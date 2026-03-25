import { NextRequest } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';

function normalizeAuthRequest(request: NextRequest): NextRequest {
  const url = new URL(request.url);

  // Always land on Home after authentication.
  if (url.pathname.endsWith('/api/auth/login')) {
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
