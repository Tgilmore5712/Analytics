import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { prisma } from '@/lib/prisma';
import { loadUserPermissionsFromDatabase, USER_PERMISSIONS } from '@/lib/permissions';

// POST - Sync permissions from database into memory (admin only)
export async function POST(request: NextRequest) {
  try {
    // Check auth
    const session = await auth0.getSession(request);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { permissions: true },
    });

    if (!user || !user.permissions.includes('OWNER') && !user.permissions.includes('ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load permissions from database
    const newPerms = await loadUserPermissionsFromDatabase(prisma);
    
    // Update the in-memory cache
    Object.keys(USER_PERMISSIONS).forEach(key => delete USER_PERMISSIONS[key]);
    Object.assign(USER_PERMISSIONS, newPerms);

    return NextResponse.json({
      success: true,
      message: 'Permissions synced from database',
      count: Object.keys(newPerms).length,
    });
  } catch (error) {
    console.error('Error syncing permissions:', error);
    return NextResponse.json(
      { error: 'Failed to sync permissions' },
      { status: 500 }
    );
  }
}

// GET - Get all current permissions
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { email: true, permissions: true },
      orderBy: { email: 'asc' },
    });

    return NextResponse.json({ data: users });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}
