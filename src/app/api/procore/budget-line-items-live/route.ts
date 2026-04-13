import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BudgetLineRow = {
  id: number | bigint;
  company_id: string;
  project_id: string;
  budget_line_item_id: string;
  name: string | null;
  cost_code: string | null;
  cost_code_description: string | null;
  line_item_type: string | null;
  uom: string | null;
  quantity: number | string | null;
  unit_cost: number | string | null;
  original_budget_amount: number | string | null;
  amount: number | string | null;
  synced_at: string;
};

function normalizeId(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const companyId = String(searchParams.get("companyId") || "").trim();
    const projectId = String(searchParams.get("projectId") || "").trim();
    const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "10000", 10) || 10000;
    const pageSize = Math.min(10000, Math.max(1, requestedPageSize));

    if (!companyId || !projectId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: companyId, projectId" },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRawUnsafe<BudgetLineRow[]>(
      `
        SELECT
          id,
          company_id,
          project_id,
          budget_line_item_id,
          name,
          cost_code,
          cost_code_description,
          line_item_type,
          uom,
          quantity,
          unit_cost,
          original_budget_amount,
          amount,
          synced_at::text
        FROM budgetlineitems
        WHERE company_id = $1
          AND project_id = $2
        ORDER BY
          COALESCE(cost_code, '') ASC,
          COALESCE(name, '') ASC,
          id DESC
        LIMIT $3
      `,
      companyId,
      projectId,
      pageSize
    );

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      count: rows.length,
      data: rows.map((row) => ({
        id: normalizeId(row.id),
        companyId: row.company_id,
        projectId: row.project_id,
        budgetLineItemId: row.budget_line_item_id,
        name: row.name,
        costCode: row.cost_code,
        costCodeDescription: row.cost_code_description,
        lineItemType: row.line_item_type,
        uom: row.uom,
        quantity: normalizeNumber(row.quantity),
        unitCost: normalizeNumber(row.unit_cost),
        originalBudgetAmount: normalizeNumber(row.original_budget_amount),
        amount: normalizeNumber(row.amount),
        syncedAt: row.synced_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch budget line items", details: message },
      { status: 500 }
    );
  }
}
