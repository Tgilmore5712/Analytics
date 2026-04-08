import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { denyDiagnosticsInProduction } from '@/lib/diagnosticsGate';

export const dynamic = 'force-dynamic';

export async function GET() {
  const blocked = denyDiagnosticsInProduction();
  if (blocked) return blocked;

  try {
    // Check how many staging records exist
    const totalStaging = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
      }
    });

    // Get samples
    const inProgressCount = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'IN_PROGRESS',
      }
    });

    const bidSubmittedCount = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'BID_SUBMITTED',
      }
    });

    const estimatingCount = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'ESTIMATING',
      }
    });

    const completeCount = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'COMPLETE',
      }
    });

    const nullStatusCount = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: null,
      }
    });

    // Get sample IN_PROGRESS projects
    const inProgressSamples = await prisma.procoreProjectStaging.findMany({
      where: {
        source: 'procore_v1_projects',
        bidBoardStatus: 'IN_PROGRESS',
      },
      take: 5,
      select: {
        externalId: true,
        name: true,
        bidBoardStatus: true,
        companyId: true,
      }
    });

    // Check budget line items
    const budgetCount = await prisma.budgetLineItem.count();
    const budgetSamples = await prisma.budgetLineItem.findMany({
      take: 3,
      select: {
        budgetLineItemId: true,
        projectId: true,
        companyId: true,
        quantity: true,
        amount: true,
      }
    });

    // Check schedule count
    const scheduleCount = await prisma.schedule.count();

    return NextResponse.json({
      staging: {
        total: totalStaging,
        statuses: {
          IN_PROGRESS: inProgressCount,
          BID_SUBMITTED: bidSubmittedCount,
          ESTIMATING: estimatingCount,
          COMPLETE: completeCount,
          NULL: nullStatusCount,
        },
        inProgressSamples,
      },
      budget: {
        totalCount: budgetCount,
        samples: budgetSamples,
      },
      schedule: {
        totalCount: scheduleCount,
      }
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
