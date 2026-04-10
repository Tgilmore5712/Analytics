import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function asArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const record = payload as UnknownRecord;
  const candidates = [record.data, record.line_items, record.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = String(body.accessToken || "").trim();
    const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();
    const bidBoardProjectId = String(body.bidBoardProjectId || body.bid_board_project_id || "").trim();
    const proposalId = String(body.proposalId || body.proposal_id || "").trim();
    const page = Math.max(1, Number.parseInt(String(body.page || "1"), 10) || 1);
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || "100"), 10) || 100));
    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();

    if (!companyId || !bidBoardProjectId || !proposalId) {
      return NextResponse.json(
        {
          error: "Missing required fields: companyId, bidBoardProjectId, proposalId",
        },
        { status: 400 }
      );
    }

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const url = `${host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
        companyId
      )}/estimating/bid_board_projects/${encodeURIComponent(
        bidBoardProjectId
      )}/proposals/${encodeURIComponent(proposalId)}/line_items?page=${page}&per_page=${perPage}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Procore-Company-Id": companyId,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        attempts.push({
          host,
          status: response.status,
          message: errorText || "No response body",
        });
        if (response.status === 404) continue;
        return NextResponse.json(
          {
            error: `Line items API error ${response.status}`,
            details: errorText,
            host,
          },
          { status: response.status }
        );
      }

      const payload = (await response.json()) as unknown;
      const lineItems = asArray(payload);

      return NextResponse.json({
        success: true,
        source: "estimating.proposal_line_items",
        companyId,
        bidBoardProjectId,
        proposalId,
        page,
        perPage,
        baseUrl: host,
        count: lineItems.length,
        lineItems,
        raw: payload,
      });
    }

    return NextResponse.json(
      {
        error: "Failed to fetch proposal line items",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch proposal line items",
        details: message,
      },
      { status: 500 }
    );
  }
}
