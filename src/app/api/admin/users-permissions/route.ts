import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { prisma } from '@/lib/prisma';

// POST - Add or update a user's permissions
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is admin
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { permissions: true },
    });

    if (!currentUser || (!currentUser.permissions.includes('OWNER') && !currentUser.permissions.includes('ADMIN'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { email, permissions } = await request.json();
    
    if (!email || !Array.isArray(permissions)) {
      return NextResponse.json(
        { error: 'Invalid request: email and permissions array required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      update: { permissions, updatedAt: new Date() },
      create: {
        email: email.toLowerCase(),
        permissions,
        isActive: true,
      },
    });

    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    console.error('Error updating user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to update permissions' },
      { status: 500 }
    );
  }
}

// GET - Get a specific user's permissions
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { email: true, permissions: true, isActive: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ data: user });
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate a user (set isActive to false)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is admin
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { permissions: true },
    });

    if (!currentUser || (!currentUser.permissions.includes('OWNER') && !currentUser.permissions.includes('ADMIN'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { email: email.toLowerCase() },
      data: { isActive: false, updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    console.error('Error deactivating user:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate user' },
      { status: 500 }
    );
  }
}
