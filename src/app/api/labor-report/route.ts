import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const reportType = params.get('type') || 'timecards'; // 'timecards' | 'productivity'
  const projectId = params.get('projectId') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';

  try {
    if (reportType === 'timecards') {
      const rows = await runTimecardQuery({ projectId, dateFrom, dateTo });
      return NextResponse.json({ rows });
    } else {
      const rows = await runProductivityQuery({ projectId, dateFrom, dateTo });
      return NextResponse.json({ rows });
    }
  } catch (err) {
    console.error('[labor-report]', err);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}

interface QueryParams {
  projectId: string;
  dateFrom: string;
  dateTo: string;
}

async function runTimecardQuery({ projectId, dateFrom, dateTo }: QueryParams) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (projectId) {
    conditions.push(`tc."procoreProjectId" = $${idx++}`);
    values.push(projectId);
  }
  if (dateFrom) {
    conditions.push(`tc.work_date >= $${idx++}::date`);
    values.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`tc.work_date <= $${idx++}::date`);
    values.push(dateTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    WITH canonical_project AS (
      SELECT DISTINCT ON (p."procoreId")
        p."procoreId", p.id, p."projectName", p.customer
      FROM "Project" p
      WHERE p."procoreId" IS NOT NULL
      ORDER BY p."procoreId", p."updatedAt" DESC, p."createdAt" DESC
    ),
    po_by_code AS (
      SELECT
        po."procoreProjectId",
        MIN(po."projectId")                              AS po_project_id,
        COALESCE(ccc.canonical_code, li."costCode")      AS effective_code,
        MIN(ccc.category)                                AS labor_category,
        MIN(CASE WHEN ccc.canonical_code IS NULL THEN li.description END) AS line_description,
        COALESCE(SUM(li.quantity), 0)                    AS budgeted_qty
      FROM "PurchaseOrderContract" po
      JOIN "PurchaseOrderLineItemContractDetail" li ON li."purchaseOrderContractId" = po.id
      LEFT JOIN cost_code_categories ccc ON ccc.cost_code = li."costCode" AND ccc.is_active = TRUE
      GROUP BY po."procoreProjectId", COALESCE(ccc.canonical_code, li."costCode"), (ccc.canonical_code IS NOT NULL)
    ),
    timecard_daily AS (
      SELECT
        t."procoreProjectId",
        t.date::date                                       AS work_date,
        COALESCE(ccc.canonical_code, t."costCodeFullCode") AS effective_code,
        MIN(t."costCodeName")                              AS tc_cost_name,
        COALESCE(SUM(t.hours), 0)                          AS labor_qty
      FROM "TimecardEntry" t
      LEFT JOIN cost_code_categories ccc ON ccc.cost_code = t."costCodeFullCode" AND ccc.is_active = TRUE
      GROUP BY t."procoreProjectId", t.date::date, COALESCE(ccc.canonical_code, t."costCodeFullCode")
    ),
    base AS (
      SELECT
        COALESCE(cp."projectName", p_fb."projectName", '(no project linked)') AS project_name,
        COALESCE(cp.customer, p_fb.customer, '')                               AS customer,
        tc."procoreProjectId"                                                  AS procore_project_id,
        tc.work_date,
        tc.effective_code                                                       AS cost_code,
        COALESCE(pb.labor_category, pb.line_description, tc.tc_cost_name, tc.effective_code) AS display_name,
        COALESCE(pb.budgeted_qty, 0)                                           AS budgeted_qty,
        tc.labor_qty
      FROM timecard_daily tc
      LEFT JOIN po_by_code        pb  ON pb."procoreProjectId" = tc."procoreProjectId" AND pb.effective_code = tc.effective_code
      LEFT JOIN canonical_project cp  ON cp."procoreId"        = tc."procoreProjectId"
      LEFT JOIN "Project" p_fb        ON p_fb.id               = pb.po_project_id AND cp."procoreId" IS NULL
    )
    SELECT
      project_name,
      customer,
      procore_project_id,
      work_date::text,
      cost_code,
      display_name,
      budgeted_qty,
      labor_qty,
      SUM(labor_qty) OVER (PARTITION BY procore_project_id, cost_code ORDER BY work_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS labor_qty_to_date,
      budgeted_qty - SUM(labor_qty) OVER (PARTITION BY procore_project_id, cost_code ORDER BY work_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS delta,
      CASE
        WHEN budgeted_qty > 0
        THEN ROUND((SUM(labor_qty) OVER (PARTITION BY procore_project_id, cost_code ORDER BY work_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / budgeted_qty * 100)::numeric, 1)
        ELSE NULL
      END AS pct_complete
    FROM base
    ${where}
    ORDER BY project_name, work_date, cost_code
  `;

  return prisma.$queryRawUnsafe(sql, ...values);
}

async function runProductivityQuery({ projectId, dateFrom, dateTo }: QueryParams) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (projectId) {
    conditions.push(`pr."procoreProjectId" = $${idx++}`);
    values.push(projectId);
  }
  if (dateFrom) {
    conditions.push(`pr.work_date >= $${idx++}::date`);
    values.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`pr.work_date <= $${idx++}::date`);
    values.push(dateTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    WITH canonical_project AS (
      SELECT DISTINCT ON (p."procoreId")
        p."procoreId", p.id, p."projectName", p.customer
      FROM "Project" p
      WHERE p."procoreId" IS NOT NULL
      ORDER BY p."procoreId", p."updatedAt" DESC, p."createdAt" DESC
    ),
    po_by_code AS (
      SELECT
        po."procoreProjectId",
        MIN(po."projectId")                              AS po_project_id,
        COALESCE(ccc.canonical_code, li."costCode")      AS effective_code,
        MIN(ccc.category)                                AS labor_category,
        MIN(CASE WHEN ccc.canonical_code IS NULL THEN li.description END) AS line_description,
        COALESCE(SUM(li.quantity), 0)                    AS budgeted_qty
      FROM "PurchaseOrderContract" po
      JOIN "PurchaseOrderLineItemContractDetail" li ON li."purchaseOrderContractId" = po.id
      LEFT JOIN cost_code_categories ccc ON ccc.cost_code = li."costCode" AND ccc.is_active = TRUE
      GROUP BY po."procoreProjectId", COALESCE(ccc.canonical_code, li."costCode"), (ccc.canonical_code IS NOT NULL)
    ),
    productivity_daily AS (
      SELECT
        pl."procoreProjectId",
        pl.date::date                                    AS work_date,
        COALESCE(ccc.canonical_code, li."costCode")      AS effective_code,
        MIN(li.description)                              AS tc_cost_name,
        COALESCE(SUM(pl."quantityUsed"), 0)              AS production_qty
      FROM "ProductivityLog" pl
      LEFT JOIN "PurchaseOrderLineItemContractDetail" li ON li."procoreId" = pl."lineItemId"
      LEFT JOIN cost_code_categories ccc ON ccc.cost_code = li."costCode" AND ccc.is_active = TRUE
      WHERE pl."quantityUsed" IS NOT NULL
      GROUP BY pl."procoreProjectId", pl.date::date, COALESCE(ccc.canonical_code, li."costCode")
    ),
    base AS (
      SELECT
        COALESCE(cp."projectName", p_fb."projectName", '(no project linked)') AS project_name,
        COALESCE(cp.customer, p_fb.customer, '')                               AS customer,
        pr."procoreProjectId"                                                  AS procore_project_id,
        pr.work_date,
        pr.effective_code                                                       AS cost_code,
        COALESCE(pb.labor_category, pb.line_description, pr.tc_cost_name, pr.effective_code) AS display_name,
        COALESCE(pb.budgeted_qty, 0)                                           AS budgeted_qty,
        pr.production_qty
      FROM productivity_daily pr
      LEFT JOIN po_by_code        pb ON pb."procoreProjectId" = pr."procoreProjectId" AND pb.effective_code = pr.effective_code
      LEFT JOIN canonical_project cp ON cp."procoreId"        = pr."procoreProjectId"
      LEFT JOIN "Project" p_fb       ON p_fb.id               = pb.po_project_id AND cp."procoreId" IS NULL
    )
    SELECT
      project_name,
      customer,
      procore_project_id,
      work_date::text,
      cost_code,
      display_name,
      budgeted_qty,
      production_qty,
      SUM(production_qty) OVER (PARTITION BY procore_project_id, cost_code ORDER BY work_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS production_qty_to_date,
      budgeted_qty - SUM(production_qty) OVER (PARTITION BY procore_project_id, cost_code ORDER BY work_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS delta,
      CASE
        WHEN budgeted_qty > 0
        THEN ROUND((SUM(production_qty) OVER (PARTITION BY procore_project_id, cost_code ORDER BY work_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / budgeted_qty * 100)::numeric, 1)
        ELSE NULL
      END AS pct_complete
    FROM base
    ${where}
    ORDER BY project_name, work_date, cost_code
  `;

  return prisma.$queryRawUnsafe(sql, ...values);
}
