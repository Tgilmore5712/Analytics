import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type LiveRow = {
  procore_project_id: string;
  name: string | null;
  project_number: string | null;
  status: string | null;
  status_raw: string | null;
  customer: string | null;
  project_stage_name: string | null;
  project_stage_category: string | null;
  bid_board_status: string | null;
  bid_board_id: string | null;
  synced_at: string;
};

function isTransientDbError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  if (code === 'P1001' || code === 'P2024') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database server|Timed out fetching a new connection from the connection pool/i.test(message);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '500', 10) || 500;
    const pageSize = Math.min(2000, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const rows = await prisma.$queryRawUnsafe<LiveRow[]>(
      `
        WITH prime_supplement AS (
          SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')))
            COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')) AS project_id,
            COALESCE(
              NULLIF(BTRIM(payload->'project'->>'name'), ''),
              NULLIF(BTRIM(payload->>'title'), ''),
              COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), ''))
            ) AS name,
            COALESCE(NULLIF(BTRIM(payload->'project'->>'project_number'), ''), number) AS project_number,
            status,
            synced_at
          FROM procore_prime_contracts_live
          WHERE COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')) IS NOT NULL
            AND COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')) NOT IN (
              SELECT procore_project_id FROM procore_projects_v1_live WHERE procore_project_id IS NOT NULL
            )
          ORDER BY COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')), synced_at DESC
        ), base AS (
          SELECT
            v.procore_project_id,
            v.name,
            v.project_number,
            v.status,
            v.status_raw,
            v.customer,
            ps.name AS project_stage_name,
            ps.category AS project_stage_category,
            COALESCE(
              bb.status,
              CASE
                WHEN LOWER(REPLACE(COALESCE(v.status, ''), '-', ' ')) = 'bidding' THEN 'BID_SUBMITTED'
                WHEN LOWER(REPLACE(COALESCE(v.status, ''), '-', ' ')) = 'pre construction' THEN 'ESTIMATING'
                WHEN LOWER(REPLACE(COALESCE(v.status, ''), '-', ' ')) = 'post construction' THEN 'COMPLETE'
                WHEN LOWER(REPLACE(COALESCE(v.status, ''), '-', ' ')) = 'course of construction' THEN 'IN_PROGRESS'
                ELSE NULL
              END
            ) AS bid_board_status,
            bb.bid_board_id,
            v.synced_at
          FROM procore_projects_v1_live v
          LEFT JOIN procore_project_stages_live ps
            ON ps.project_stage_id = (v.payload->'project_stage'->>'id')
          LEFT JOIN LATERAL (
            SELECT b.status, b.bid_board_id
            FROM procore_bid_board_live b
            WHERE b.procore_project_id = v.procore_project_id
            ORDER BY b.synced_at DESC
            LIMIT 1
          ) bb ON TRUE
          UNION ALL
          SELECT
            p.project_id AS procore_project_id,
            p.name,
            p.project_number,
            p.status,
            p.status AS status_raw,
            NULL::text AS customer,
            NULL::text AS project_stage_name,
            NULL::text AS project_stage_category,
            CASE
              WHEN LOWER(REPLACE(COALESCE(p.status, ''), '-', ' ')) = 'bidding' THEN 'BID_SUBMITTED'
              WHEN LOWER(REPLACE(COALESCE(p.status, ''), '-', ' ')) = 'pre construction' THEN 'ESTIMATING'
              WHEN LOWER(REPLACE(COALESCE(p.status, ''), '-', ' ')) = 'post construction' THEN 'COMPLETE'
              WHEN LOWER(REPLACE(COALESCE(p.status, ''), '-', ' ')) = 'course of construction' THEN 'IN_PROGRESS'
              ELSE NULL
            END AS bid_board_status,
            NULL::text AS bid_board_id,
            p.synced_at
          FROM prime_supplement p
        ), ranked AS (
          SELECT
            base.*,
            ROW_NUMBER() OVER (
              PARTITION BY base.procore_project_id
              ORDER BY base.synced_at DESC
            ) AS rn
          FROM base
        )
        SELECT
          procore_project_id,
          name,
          project_number,
          status,
          status_raw,
          customer,
          project_stage_name,
          project_stage_category,
          bid_board_status,
          bid_board_id,
          synced_at
        FROM ranked
        WHERE rn = 1
        ORDER BY name ASC NULLS LAST
        LIMIT $1
        OFFSET $2
      `,
      pageSize,
      skip
    );

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `
        WITH prime_supplement AS (
          SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')))
            COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')) AS project_id,
            COALESCE(
              NULLIF(BTRIM(payload->'project'->>'name'), ''),
              NULLIF(BTRIM(payload->>'title'), ''),
              COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), ''))
            ) AS name,
            synced_at
          FROM procore_prime_contracts_live
          WHERE COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')) IS NOT NULL
            AND COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')) NOT IN (
              SELECT procore_project_id FROM procore_projects_v1_live WHERE procore_project_id IS NOT NULL
            )
          ORDER BY COALESCE(NULLIF(BTRIM(project_id), ''), NULLIF(BTRIM(project_procore_id), '')), synced_at DESC
        ), all_projects AS (
          SELECT v.procore_project_id, v.synced_at
          FROM procore_projects_v1_live v
          UNION ALL
          SELECT p.project_id AS procore_project_id, p.synced_at
          FROM prime_supplement p
        ), ranked AS (
          SELECT
            ROW_NUMBER() OVER (
              PARTITION BY ap.procore_project_id
              ORDER BY ap.synced_at DESC
            ) AS rn
          FROM all_projects ap
        )
        SELECT COUNT(*)::int AS total
        FROM ranked
        WHERE rn = 1
      `
    );

    const total = countRows[0]?.total ?? 0;
    const hasNextPage = skip + rows.length < total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const data = rows.map((row) => ({
      id: row.procore_project_id,
      procoreId: row.procore_project_id,
      projectName: row.name,
      projectNumber: row.project_number,
      status: row.status,
      statusRaw: row.status_raw,
      projectStageName: row.project_stage_name,
      projectStageCategory: row.project_stage_category,
      bidBoardStatus: row.bid_board_status,
      bidBoardId: row.bid_board_id,
      customer: row.customer,
      statusSource: 'procore_v1_live',
      syncedAt: row.synced_at,
    }));

    return NextResponse.json({
      success: true,
      count: data.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage,
      hasPreviousPage: page > 1,
      data,
    });
  } catch (error) {
    console.error('Failed to fetch projects-v1-live:', error);
    if (isTransientDbError(error)) {
      return NextResponse.json(
        {
          success: false,
          degraded: true,
          error: 'Database temporarily unavailable',
          count: 0,
          total: 0,
          page: 1,
          pageSize: 500,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
          data: [],
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to fetch live Procore projects' },
      { status: 500 }
    );
  }
}
