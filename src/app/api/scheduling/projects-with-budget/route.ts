import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type ProjectBudgetRow = {
  projectId: string;
  projectName: string | null;
  bidBoardStatus: string | null;
  totalQuantity: number | null;
  totalAmount: number | null;
  lineItemCount: number;
  syncedAt: string;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const bidBoardStatus = String(searchParams.get('bidBoardStatus') || 'IN_PROGRESS').trim();
    const companyId = String(searchParams.get('companyId') || '598134325658789').trim();

    const rows = await prisma.$queryRawUnsafe<ProjectBudgetRow[]>(
      `
        SELECT
          s.external_id AS projectId,
          s.name AS projectName,
          s.bid_board_status AS bidBoardStatus,
          SUM(COALESCE(b.quantity, 0))::float AS totalQuantity,
          SUM(COALESCE(b.amount, 0))::float AS totalAmount,
          COUNT(DISTINCT b.id)::int AS lineItemCount,
          MAX(s.synced_at)::text AS syncedAt
        FROM procore_project_staging s
        LEFT JOIN budgetlineitems b
          ON b.company_id = s.company_id
          AND b.project_id = s.procore_project_id
        WHERE s.source = 'procore_v1_projects'
          AND s.company_id = $1
          AND ($2::text IS NULL OR s.bid_board_status = $2::text)
        GROUP BY s.external_id, s.name, s.bid_board_status, s.synced_at
        ORDER BY s.name ASC NULLS LAST
      `,
      companyId,
      bidBoardStatus || null
    );

    return NextResponse.json({
      success: true,
      count: rows.length,
      bidBoardStatus: bidBoardStatus || null,
      companyId,
      data: rows.map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        bidBoardStatus: row.bidBoardStatus,
        totalQuantity: row.totalQuantity || 0,
        totalAmount: row.totalAmount || 0,
        lineItemCount: row.lineItemCount,
        syncedAt: row.syncedAt,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch projects with budget:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects with budget' },
      { status: 500 }
    );
  }
}
