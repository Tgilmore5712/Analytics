/**
 * Hook to preserve Procore page location across refresh/re-auth
 * Stores current Procore pathname and redirects to login with returnTo if auth is lost
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function useProcoreAuthAfterRefresh() {
  const pathname = usePathname();
  const REDIRECT_COOLDOWN_MS = 30_000;
  const REDIRECT_TS_KEY = 'procore_auth_redirect_ts';

  useEffect(() => {
    // Store current Procore page path in session storage
    if (typeof window !== 'undefined' && pathname?.startsWith('/procore/')) {
      try {
        sessionStorage.setItem('procore_last_page', pathname);
      } catch {
        // Ignore storage write failures
      }
    }
  }, [pathname]);

  useEffect(() => {
    // If we're on a Procore page and auth check fails, redirect to login with returnTo
    const checkProcoreAuth = async () => {
      try {
        const response = await fetch('/api/procore/me', { credentials: 'include', cache: 'no-store' });

        // Only treat explicit unauthenticated responses as login triggers.
        // Do not redirect on 403/404/500 because those can cause auth loops in production.
        if (response.status === 401 && pathname?.startsWith('/procore/')) {
          try {
            const lastRedirectAt = Number(sessionStorage.getItem(REDIRECT_TS_KEY) || '0');
            const now = Date.now();
            if (Number.isFinite(lastRedirectAt) && now - lastRedirectAt < REDIRECT_COOLDOWN_MS) {
              return;
            }
            sessionStorage.setItem(REDIRECT_TS_KEY, String(now));
          } catch {
            // Ignore storage read/write failures and continue with redirect.
          }

          // Auth failed, redirect to login with current page as returnTo
          const returnTo = encodeURIComponent(pathname);
          const loginUrl = `/api/auth/procore/login?returnTo=${returnTo}`;
          window.location.href = loginUrl;
        }
      } catch {
        // Ignore auth check errors
      }
    };

    // Only run this on Procore pages
    if (typeof window !== 'undefined' && pathname?.startsWith('/procore/')) {
      // Check on mount in case auth was lost
      checkProcoreAuth();
    }
  }, [pathname]);
}

export function getLastProcorePage(): string | null {
  if (typeof window !== 'undefined') {
    try {
      return sessionStorage.getItem('procore_last_page');
    } catch {
      return null;
    }
  }
  return null;
}
