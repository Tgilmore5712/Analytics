import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asArray(payload: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const defaultKeys = ["data", "items", "results"];
  const candidates = [...keys, ...defaultKeys];
  for (const key of candidates) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
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

    if (!companyId) {
      return NextResponse.json({ error: "Missing required field: companyId" }, { status: 400 });
    }

    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();

    const fetchAll = body.fetchAll === true;
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || "100"), 10) || 100));
    const bidBoardStatusFilter = String(body["filters[by_status]"] || body.bidBoardStatusFilter || "All").trim() || "All";
    const maxBidBoardProjects = Math.min(
      5000,
      Math.max(1, Number.parseInt(String(body.maxBidBoardProjects || "100"), 10) || 100)
    );
    const maxProposalsPerProject = Math.min(
      500,
      Math.max(1, Number.parseInt(String(body.maxProposalsPerProject || "50"), 10) || 50)
    );

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const baseHost = host.replace(/\/$/, "");

      async function getJson(path: string): Promise<unknown> {
        const response = await fetch(`${baseHost}${path}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Procore-Company-Id": companyId,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(`HTTP ${response.status}: ${errorText || "No response body"}`) as Error & {
            status?: number;
            details?: string;
          };
          err.status = response.status;
          err.details = errorText;
          throw err;
        }

        return response.json();
      }

      try {
        const bidBoardProjects: unknown[] = [];
        let page = 1;

        while (true) {
          const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
          });
          if (bidBoardStatusFilter) {
            params.set("filters[by_status]", bidBoardStatusFilter);
          }

          const payload = await getJson(
            `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects?${params.toString()}`
          );
          const pageItems = asArray(payload, ["data", "projects", "bid_board_projects"]);
          if (pageItems.length === 0) break;

          bidBoardProjects.push(...pageItems);
          if (!fetchAll || pageItems.length < perPage || bidBoardProjects.length >= maxBidBoardProjects) break;
          page += 1;
        }

        const limitedBidBoardProjects = bidBoardProjects.slice(0, maxBidBoardProjects);
        const proposals: Array<{
          bidBoardProjectId: string;
          procoreProjectId: string | null;
          projectName: string | null;
          customerName: string | null;
          proposal: unknown;
        }> = [];
        const projectSummaries: Array<{
          bidBoardProjectId: string;
          procoreProjectId: string | null;
          projectName: string | null;
          customerName: string | null;
          proposalCount: number;
        }> = [];

        for (const project of limitedBidBoardProjects) {
          const projectRecord = isRecord(project) ? project : {};
          const bidBoardProjectId = String(projectRecord.id || projectRecord.bid_board_project_id || "").trim();
          if (!bidBoardProjectId) continue;

          const procoreProjectId =
            String(projectRecord.project_id || projectRecord.procore_project_id || "").trim() || null;
          const projectName = String(projectRecord.name || projectRecord.title || "").trim() || null;
          const customerName =
            String(projectRecord.customer_name || "").trim() ||
            (isRecord(projectRecord.customer_company) ? String(projectRecord.customer_company.name || "").trim() : "") ||
            null;

          const projectProposals: unknown[] = [];
          let proposalPage = 1;

          while (true) {
            try {
              const proposalPayload = await getJson(
                `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                  bidBoardProjectId
                )}/proposals?page=${proposalPage}&per_page=${perPage}`
              );
              const proposalItems = asArray(proposalPayload, ["data", "proposals"]);
              if (proposalItems.length === 0) break;

              projectProposals.push(...proposalItems);
              if (!fetchAll || proposalItems.length < perPage || projectProposals.length >= maxProposalsPerProject) break;
              proposalPage += 1;
            } catch (error) {
              const status = Number((error as { status?: number })?.status || 0);
              if (status === 404) break;
              throw error;
            }
          }

          const limitedProposals = projectProposals.slice(0, maxProposalsPerProject);
          for (const proposal of limitedProposals) {
            proposals.push({
              bidBoardProjectId,
              procoreProjectId,
              projectName,
              customerName,
              proposal,
            });
          }

          projectSummaries.push({
            bidBoardProjectId,
            procoreProjectId,
            projectName,
            customerName,
            proposalCount: limitedProposals.length,
          });
        }

        return NextResponse.json({
          success: true,
          source: "estimating.proposals_bulk",
          companyId,
          baseUrl: baseHost,
          filters: {
            byStatus: bidBoardStatusFilter || null,
          },
          limits: {
            fetchAll,
            perPage,
            maxBidBoardProjects,
            maxProposalsPerProject,
          },
          counts: {
            bidBoardProjectsFetched: bidBoardProjects.length,
            bidBoardProjectsProcessed: limitedBidBoardProjects.length,
            projectSummaries: projectSummaries.length,
            proposals: proposals.length,
          },
          bidBoardProjects: limitedBidBoardProjects,
          projectSummaries,
          proposals,
        });
      } catch (error) {
        const status = Number((error as { status?: number })?.status || 500);
        const details = (error as { details?: string })?.details || (error instanceof Error ? error.message : String(error));

        attempts.push({
          host,
          status,
          message: details,
        });

        if (status !== 404) {
          return NextResponse.json(
            {
              error: `Bulk proposals API error ${status}`,
              details,
              host,
              attempts,
            },
            { status }
          );
        }
      }
    }

    return NextResponse.json(
      {
        error: "Failed to fetch bulk proposals",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch bulk proposals",
        details: message,
      },
      { status: 500 }
    );
  }
}
