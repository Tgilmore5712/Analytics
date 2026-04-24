"use client";

type DevLoginUser = {
  email: string;
  name: string;
};

function parseDevLoginUsers(): DevLoginUser[] {
  const raw = process.env.NEXT_PUBLIC_DEV_LOGIN_USERS_JSON;
  if (!raw || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is DevLoginUser =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { email?: unknown }).email === "string" &&
          typeof (item as { name?: unknown }).name === "string"
      )
      .map((item) => ({
        email: item.email.trim(),
        name: item.name.trim(),
      }))
      .filter((item) => item.email.length > 0 && item.name.length > 0);
  } catch {
    return [];
  }
}

/**
 * Development Login Page
 * Makes it easy to test with different user accounts locally
 */
export default function DevLoginPage() {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
    window.location.href = '/login';
    return null;
  }

  const testUsers = parseDevLoginUsers();

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        background: 'white',
        borderRadius: 16,
        padding: 40,
        maxWidth: 500,
        width: '90%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{ color: '#333', fontSize: 28, marginBottom: 10 }}>🛠️ Developer Login</h1>
          <p style={{ color: '#666', fontSize: 14 }}>
            {process.env.NODE_ENV === 'production' 
              ? 'Not available in production' 
              : 'Select a user to test with (no Auth0 required)'}
          </p>
        </div>

        {process.env.NODE_ENV !== 'production' && (
          <>
            <div style={{ marginBottom: 20 }}>
              {testUsers.map((user) => (
                <a
                  key={user.email}
                  href={`/api/auth/dev-login?email=${encodeURIComponent(user.email)}&returnTo=/`}
                  style={{
                    display: 'block',
                    padding: '16px 20px',
                    marginBottom: 12,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    borderRadius: 8,
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 15,
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
                  }}
                >
                  <div>{user.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>{user.email}</div>
                </a>
              ))}

              {testUsers.length === 0 && (
                <div style={{ fontSize: 14, color: '#666', padding: '8px 0' }}>
                  No preset users configured. Set NEXT_PUBLIC_DEV_LOGIN_USERS_JSON to populate quick-login accounts.
                </div>
              )}
            </div>

            <div style={{ 
              padding: '16px 20px',
              background: '#f8f9fa',
              borderRadius: 8,
              marginTop: 20,
              border: '1px solid #dee2e6'
            }}>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 10 }}>
                <strong>Custom Email:</strong>
              </div>
              <form action="/api/auth/dev-login" method="GET" style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  name="email"
                  placeholder="Enter any email..."
                  required
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    border: '2px solid #dee2e6',
                    borderRadius: 6,
                    fontSize: 14,
                    outline: 'none',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#667eea'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#dee2e6'}
                />
                <input type="hidden" name="returnTo" value="/" />
                <button
                  type="submit"
                  style={{
                    padding: '10px 20px',
                    background: '#15616D',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Login
                </button>
              </form>
            </div>

            <div style={{ 
              marginTop: 30, 
              paddingTop: 20, 
              borderTop: '1px solid #e9ecef',
              textAlign: 'center' 
            }}>
              <a
                href="/login"
                style={{
                  color: '#667eea',
                  fontSize: 14,
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Use real Auth0 login instead {"\u2192"}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
