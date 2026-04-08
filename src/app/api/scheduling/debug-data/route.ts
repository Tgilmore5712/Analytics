import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { denyDiagnosticsInProduction } from '@/lib/diagnosticsGate';

export const dynamic = 'force-dynamic';

type StatusCountRow = {
  status: string | null;
  total: number;
};

type InProgressSampleRow = {
  externalid: string | null;
  name: string | null;
  bidboardstatus: string | null;
  companyid: string | null;
};

export async function GET() {
  const blocked = denyDiagnosticsInProduction();
  if (blocked) return blocked;

  try {
    const totalStaging = await prisma.procoreProjectStaging.count({
      where: {
        source: 'procore_v1_projects',
      }
    });

    const statusCounts = await prisma.$queryRawUnsafe<StatusCountRow[]>(`
      SELECT
        NULLIF(
          UPPER(
            TRIM(
              COALESCE(
                payload->>'bidBoardStatus',
                payload->>'bid_board_status',
                status,
                ''
              )
            )
          ),
          ''
        ) AS status,
        COUNT(*)::int AS total
      FROM procore_project_staging
      WHERE source = 'procore_v1_projects'
      GROUP BY 1
    `);

    const countsByStatus = new Map<string, number>();
    let nullStatusCount = 0;

    for (const row of statusCounts) {
      if (row.status) {
        countsByStatus.set(row.status, Number(row.total || 0));
      } else {
        nullStatusCount = Number(row.total || 0);
      }
    }

    const inProgressSamples = await prisma.$queryRawUnsafe<InProgressSampleRow[]>(`
      SELECT
        external_id AS externalId,
        name,
        NULLIF(
          UPPER(
            TRIM(
              COALESCE(
                payload->>'bidBoardStatus',
                payload->>'bid_board_status',
                status,
                ''
              )
            )
          ),
          ''
        ) AS bidBoardStatus,
        company_id AS companyId
      FROM procore_project_staging
      WHERE source = 'procore_v1_projects'
        AND NULLIF(
          UPPER(
            TRIM(
              COALESCE(
                payload->>'bidBoardStatus',
                payload->>'bid_board_status',
                status,
                ''
              )
            )
          ),
          ''
        ) = 'IN_PROGRESS'
      ORDER BY synced_at DESC
      LIMIT 5
    `);

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
          IN_PROGRESS: countsByStatus.get('IN_PROGRESS') || 0,
          BID_SUBMITTED: countsByStatus.get('BID_SUBMITTED') || 0,
          ESTIMATING: countsByStatus.get('ESTIMATING') || 0,
          COMPLETE: countsByStatus.get('COMPLETE') || 0,
          NULL: nullStatusCount,
        },
        inProgressSamples: inProgressSamples.map((row) => ({
          externalId: row.externalid,
          name: row.name,
          bidBoardStatus: row.bidboardstatus,
          companyId: row.companyid,
        })),
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
