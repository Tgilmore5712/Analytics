import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { expandAssignedPermissions, loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';
import { createPermissionCookieValue, getPermissionCookieOptions, PERMISSION_COOKIE_NAME } from '@/lib/permissionCookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const email = await getRequestUserEmail(request);
    if (!email) {
      return NextResponse.json({ allowed: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as { permission?: unknown } | null;
    const permission = typeof body?.permission === 'string' ? body.permission.trim() : '';
    if (!permission) {
      return NextResponse.json({ allowed: false, error: 'Permission required' }, { status: 400 });
    }

    const assignedPermissions = await loadUserAssignedPermissionsFromDatabase(prisma, email);
    const permissions = expandAssignedPermissions(assignedPermissions);
    const allowed = permissions.some((userPermission) => userPermission.toLowerCase() === permission.toLowerCase());
    const cookieValue = await createPermissionCookieValue(email, permissions);
    const response = NextResponse.json({ allowed, email, permission, permissionsCookie: cookieValue });

    if (cookieValue) {
      response.cookies.set(PERMISSION_COOKIE_NAME, cookieValue, getPermissionCookieOptions());
    }

    return response;
  } catch (error) {
    console.error('Error checking permissions:', error);
    return NextResponse.json(
      { allowed: false, error: 'Failed to check permissions' },
      { status: 500 }
    );
  }
}