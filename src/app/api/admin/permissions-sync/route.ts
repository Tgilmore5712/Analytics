import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - Get all current permissions (accessible to authenticated users)
export async function GET(request: NextRequest) {
  try {
    // Use raw SQL since the user table was created directly (no Prisma migration)
    const users = await prisma.$queryRaw<{ email: string; permissions: string[] }[]>`
      SELECT email, permissions
      FROM "user"
      WHERE "isActive" = true
      ORDER BY email ASC
    `;

    return NextResponse.json({ 
      success: true,
      data: users 
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions', detail: String(error) },
      { status: 500 }
    );
  }
}

// POST - same as GET, for compat
export async function POST(request: NextRequest) {
  return GET(request);
}
