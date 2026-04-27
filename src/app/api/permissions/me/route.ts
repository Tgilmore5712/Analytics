import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { expandAssignedPermissions, loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';
import { createPermissionCookieValue, getPermissionCookieOptions, PERMISSION_COOKIE_NAME } from '@/lib/permissionCookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const email = await getRequestUserEmail(request);
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await loadUserAssignedPermissionsFromDatabase(prisma, email);
    const expandedPermissions = expandAssignedPermissions(permissions);
    const response = NextResponse.json({ success: true, data: { email, permissions, expandedPermissions } });
    const cookieValue = await createPermissionCookieValue(email, expandedPermissions);

    if (cookieValue) {
      response.cookies.set(PERMISSION_COOKIE_NAME, cookieValue, getPermissionCookieOptions());
    }

    return response;
  } catch (error) {
    console.error('Error fetching current user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}