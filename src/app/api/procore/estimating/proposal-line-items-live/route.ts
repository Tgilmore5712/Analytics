import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ProposalLineItemLiveRow = {
  id: number;
  company_id: string;
  bid_board_project_id: string;
  proposal_id: string;
  line_item_id: string;
  project_name: string | null;
  customer_name: string | null;
  proposal_name: string | null;
  name: string | null;
  status: string | null;
  cost_code: string | null;
  payload: unknown;
  synced_at: string;
};

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || "").toUpperCase();
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "200", 10) || 200;
    const pageSize = Math.min(2000, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const companyId = String(searchParams.get("companyId") || "").trim();
    const bidBoardProjectId = String(searchParams.get("bidBoardProjectId") || "").trim();
    const proposalId = String(searchParams.get("proposalId") || "").trim();
    const search = String(searchParams.get("search") || "").trim();

    const whereParts: string[] = [];
    const values: unknown[] = [];

    if (companyId) {
      values.push(companyId);
      whereParts.push(`company_id = $${values.length}`);
    }

    if (bidBoardProjectId) {
      values.push(bidBoardProjectId);
      whereParts.push(`bid_board_project_id = $${values.length}`);
    }

    if (proposalId) {
      values.push(proposalId);
      whereParts.push(`proposal_id = $${values.length}`);
    }

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      whereParts.push(
        `(
          LOWER(COALESCE(name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(status, '')) LIKE $${values.length}
          OR LOWER(COALESCE(cost_code, '')) LIKE $${values.length}
          OR LOWER(COALESCE(project_name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(customer_name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(proposal_name, '')) LIKE $${values.length}
          OR LOWER(COALESCE(line_item_id, '')) LIKE $${values.length}
          OR LOWER(COALESCE(bid_board_project_id, '')) LIKE $${values.length}
          OR LOWER(COALESCE(proposal_id, '')) LIKE $${values.length}
        )`
      );
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const rows = await prisma.$queryRawUnsafe<ProposalLineItemLiveRow[]>(
      `
        SELECT
          id,
          company_id,
          bid_board_project_id,
          proposal_id,
          line_item_id,
          project_name,
          customer_name,
          proposal_name,
          name,
          status,
          cost_code,
          payload,
          synced_at
        FROM procore_proposal_line_items_live
        ${whereClause}
        ORDER BY synced_at DESC, id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      pageSize,
      skip
    );

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `
        SELECT COUNT(*)::int AS total
        FROM procore_proposal_line_items_live
        ${whereClause}
      `,
      ...values
    );

    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      count: rows.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: skip + rows.length < total,
      hasPreviousPage: page > 1,
      data: rows.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        bidBoardProjectId: row.bid_board_project_id,
        proposalId: row.proposal_id,
        lineItemId: row.line_item_id,
        projectName: row.project_name,
        customerName: row.customer_name,
        proposalName: row.proposal_name,
        name: row.name,
        status: row.status,
        costCode: row.cost_code,
        payload: row.payload,
        syncedAt: row.synced_at,
      })),
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({
        success: true,
        count: 0,
        total: 0,
        page: 1,
        pageSize: 200,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        data: [],
        note:
          "procore_proposal_line_items_live is not available yet. Apply the migration, then run the bulk sync with persist enabled.",
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch persisted proposal line items", details: message },
      { status: 500 }
    );
  }
}
