import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST - Sync permissions from database into memory (admin only)
export async function POST(request: NextRequest) {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { email: true, permissions: true },
    });

    return NextResponse.json({
      success: true,
      message: 'Permissions synced',
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error('Error syncing permissions:', error);
    return NextResponse.json(
      { error: 'Failed to sync permissions' },
      { status: 500 }
    );
  }
}

// GET - Get all current permissions (accessible to authenticated users)
export async function GET(request: NextRequest) {
  try {
    // Just return all active users' permissions - middleware already protects this route
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { email: true, permissions: true },
      orderBy: { email: 'asc' },
    });

    return NextResponse.json({ 
      success: true,
      data: users 
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}
