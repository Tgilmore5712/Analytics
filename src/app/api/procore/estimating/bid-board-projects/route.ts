import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL =
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function unwrapBidBoardProjects(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [
    payload.data,
    payload.projects,
    payload.bid_board_projects,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeStatusValue(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function getProjectStatus(project: unknown): string {
  if (!isRecord(project)) return "";
  return String(
    project.status ||
      project.bid_status ||
      (isRecord(project.bid_status) ? project.bid_status.name : "") ||
      ""
  ).trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      accessToken: bodyToken,
      companyId: companyIdFromBody,
      page = 1,
      perPage = 100,
      fetchAll = true,
      baseUrl = process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL,
    } = body;

    const byStatusRaw = String(
      body["filters[by_status]"] || body.filtersByStatus || body.byStatus || body.statuses || ""
    ).trim();
    const byStatusNormalized = normalizeStatusValue(byStatusRaw);
    const shouldFilterByStatus = Boolean(byStatusNormalized) && byStatusNormalized !== "all";

    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Missing access token. Please authenticate via OAuth first or provide accessToken in request body.",
        },
        { status: 401 }
      );
    }

    const companyId = String(companyIdFromBody || procoreConfig.companyId || '').trim();
    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in request body." },
        { status: 400 }
      );
    }

    const safePerPage = Math.min(Math.max(Number(perPage) || 100, 1), 200);
    let currentPage = Math.max(Number(page) || 1, 1);

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: baseUrl,
      extraOrigins: [
        process.env.PROCORE_ESTIMATING_API_URL,
        DEFAULT_ESTIMATING_BASE_URL,
        "https://api.procore.com",
      ],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    let allProjects: unknown[] = [];
    let successfulHost = "";
    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const hostRows: unknown[] = [];
      currentPage = Math.max(Number(page) || 1, 1);
      let hostWorked = false;

      while (true) {
        const params = new URLSearchParams({
          page: String(currentPage),
          per_page: String(safePerPage),
        });

        const url = `${host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
          companyId
        )}/estimating/bid_board_projects?${params.toString()}`;

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${String(accessToken).trim()}`,
            Accept: "application/json",
            "Procore-Company-Id": companyId,
          },
        });

        if (!response.ok) {
          const errorBody = await response.text();
          attempts.push({
            host,
            status: response.status,
            message: errorBody || "No response body",
          });

          if (response.status === 404) {
            break;
          }

          throw new Error(`Estimating API error ${response.status} from ${host}: ${errorBody}`);
        }

        hostWorked = true;
        const data: unknown = await response.json();
        const pageItems = unwrapBidBoardProjects(data);

        hostRows.push(...pageItems);

        // Crucial: Only stop if we got NO items on this page, or if fetchAll is explicitly false
        if (!fetchAll || pageItems.length === 0) {
          break;
        }

        // Even if we got fewer than safePerPage (e.g., 45), we should try at least once 
        // to see if there is a next page unless we got absolute 0.
        // Procore sometimes returns short pages even if more data exists.
        currentPage += 1;
        
        // Safety cap for projects list
        if (currentPage > 20) break;
      }

      if (hostWorked) {
        allProjects = hostRows;
        successfulHost = host;
        break;
      }
    }

    if (!successfulHost) {
      return NextResponse.json(
        {
          error: "Failed to fetch estimating bid board projects",
          details: "All configured hosts returned 404 or failed",
          attempts,
        },
        { status: 404 }
      );
    }

    const filteredProjects = shouldFilterByStatus
      ? allProjects.filter((project) => normalizeStatusValue(getProjectStatus(project)) === byStatusNormalized)
      : allProjects;

    return NextResponse.json({
      success: true,
      companyId,
      source: "estimating.bid_board_projects",
      baseUrl: successfulHost,
      attemptedHosts: hostCandidates.candidates,
      fetchAll,
      filters: {
        byStatus: byStatusRaw || null,
        applied: shouldFilterByStatus,
      },
      startPage: Math.max(Number(page) || 1, 1),
      perPage: safePerPage,
      count: filteredProjects.length,
      projects: filteredProjects,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore estimating bid board projects API error:", message);

    return NextResponse.json(
      {
        error: "Failed to fetch estimating bid board projects",
        details: message,
      },
      { status: 500 }
    );
  }
}
