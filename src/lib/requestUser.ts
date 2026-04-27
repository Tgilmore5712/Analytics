import { NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function getRequestUserEmail(request: NextRequest): Promise<string | null> {
  const isDev = process.env.NODE_ENV !== 'production';
  const selectedDevEmail = request.cookies.get('dev_user_email')?.value?.trim().toLowerCase();
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain');

  if (isDev && selectedDevEmail) {
    return selectedDevEmail;
  }

  if (isDev && auth0Misconfigured) {
    return 'dev@example.com';
  }

  const session = await auth0.getSession(request);
  return session?.user?.email?.trim().toLowerCase() || null;
}