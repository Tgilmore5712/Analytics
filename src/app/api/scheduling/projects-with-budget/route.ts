import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type ProjectBudgetRow = {
  projectid: string;
  projectname: string | null;
  customer: string | null;
  bidboardstatus: string | null;
  totalquantity: number | null;
  totalamount: number | null;
  lineitemcount: number;
  syncedat: string;
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
          s.customer AS customer,
          s.bid_board_status AS bidBoardStatus,
          SUM(COALESCE(b.quantity, 0))::float AS totalQuantity,
          SUM(COALESCE(b.amount, 0))::float AS totalAmount,
          COUNT(DISTINCT b.id)::int AS lineItemCount,
          MAX(s.synced_at)::text AS syncedAt
        FROM procore_project_staging s
        LEFT JOIN budgetlineitems b
          ON b.company_id = s.company_id
          AND b.project_id = s.procore_project_id
          AND LOWER(b.uom) IN ('hours', 'hr', 'hrs')
          AND LOWER(COALESCE(b.cost_code, '')) NOT IN ('project management.other', '01-300-10-20.o')
        WHERE s.source = 'procore_v1_projects'
          AND s.company_id = $1
          AND s.external_id IS NOT NULL
          AND s.name IS NOT NULL
          AND ($2::text IS NULL OR s.bid_board_status = $2::text)
        GROUP BY s.external_id, s.name, s.customer, s.bid_board_status, s.synced_at
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
        projectId: row.projectid,
        projectName: row.projectname,
        customer: row.customer || '',
        bidBoardStatus: row.bidboardstatus,
        totalQuantity: row.totalquantity || 0,
        totalAmount: row.totalamount || 0,
        lineItemCount: row.lineitemcount,
        syncedAt: row.syncedat,
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
