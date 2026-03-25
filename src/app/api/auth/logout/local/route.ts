import { NextResponse } from 'next/server';

function buildLogoutCookieResponse() {
  const response = NextResponse.json({ success: true });

  const cookieNames = [
    '__session',
    'appSession',
    'procore_access_token',
    'procore_refresh_token',
    'procore_company_id',
  ];

  cookieNames.forEach((cookieName) => {
    response.cookies.set(cookieName, '', {
      expires: new Date(0),
      httpOnly: true,
      path: '/',
      sameSite: 'none',
      secure: true,
    });

    response.cookies.set(cookieName, '', {
      expires: new Date(0),
      httpOnly: false,
      path: '/',
      sameSite: 'none',
      secure: true,
    });
  });

  return response;
}

export async function POST() {
  return buildLogoutCookieResponse();
}

export async function GET() {
  return buildLogoutCookieResponse();
}