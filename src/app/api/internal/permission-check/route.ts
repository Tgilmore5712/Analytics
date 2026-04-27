import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';

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

    const allowed = await hasDatabasePageAccess(prisma, email, permission);
    return NextResponse.json({ allowed, email, permission });
  } catch (error) {
    console.error('Error checking permissions:', error);
    return NextResponse.json(
      { allowed: false, error: 'Failed to check permissions' },
      { status: 500 }
    );
  }
}