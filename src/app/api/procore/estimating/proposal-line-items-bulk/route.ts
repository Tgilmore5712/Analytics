import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

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

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || "").toUpperCase();
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

async function assertProposalLineItemsLiveTableExists() {
  await prisma.$queryRawUnsafe(`SELECT 1 FROM procore_proposal_line_items_live LIMIT 1`);
}

function getLineItemId(lineItem: unknown, bidBoardProjectId: string, proposalId: string): string {
  if (isRecord(lineItem)) {
    const directId = String(lineItem.id || lineItem.line_item_id || "").trim();
    if (directId) return directId;
  }

  const fallbackSeed = `${bidBoardProjectId}:${proposalId}:${JSON.stringify(lineItem)}`;
  return createHash("sha256").update(fallbackSeed).digest("hex");
}

async function upsertProposalLineItemLive(params: {
  companyId: string;
  bidBoardProjectId: string;
  proposalId: string;
  projectName: string | null;
  customerName: string | null;
  proposalName: string | null;
  lineItem: unknown;
}) {
  const { companyId, bidBoardProjectId, proposalId, projectName, customerName, proposalName, lineItem } = params;
  const itemRecord = isRecord(lineItem) ? lineItem : {};

  const lineItemId = getLineItemId(lineItem, bidBoardProjectId, proposalId);
  const name = String(itemRecord.name || itemRecord.description || itemRecord.title || "").trim() || null;
  const status = String(itemRecord.status || "").trim() || null;
  const costCode = isRecord(itemRecord.cost_code)
    ? String(itemRecord.cost_code.code || itemRecord.cost_code.name || "").trim() || null
    : (String(itemRecord.cost_code || "").trim() || null);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_proposal_line_items_live
        (company_id, bid_board_project_id, proposal_id, line_item_id, project_name, customer_name, proposal_name, name, status, cost_code, payload, synced_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW())
      ON CONFLICT (company_id, bid_board_project_id, proposal_id, line_item_id)
      DO UPDATE
      SET
        project_name = EXCLUDED.project_name,
        customer_name = EXCLUDED.customer_name,
        proposal_name = EXCLUDED.proposal_name,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        cost_code = EXCLUDED.cost_code,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    bidBoardProjectId,
    proposalId,
    lineItemId,
    projectName,
    customerName,
    proposalName,
    name,
    status,
    costCode,
    JSON.stringify(lineItem ?? {})
  );
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

    const fetchAll = body.fetchAll !== false;
    const persist = body.persist === true;
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || "100"), 10) || 100));
    const bidBoardStatusFilter = String(body["filters[by_status]"] || body.bidBoardStatusFilter || "All").trim() || "All";

    const maxBidBoardProjects = Math.min(5000, Math.max(1, Number.parseInt(String(body.maxBidBoardProjects || "1000"), 10) || 1000));
    const maxProposalsPerProject = Math.min(500, Math.max(1, Number.parseInt(String(body.maxProposalsPerProject || "200"), 10) || 200));
    const maxLineItemsPages = Math.min(100, Math.max(1, Number.parseInt(String(body.maxLineItemsPages || "50"), 10) || 50));

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

      if (persist) {
        try {
          await assertProposalLineItemsLiveTableExists();
        } catch (tableError) {
          if (isMissingTableError(tableError)) {
            return NextResponse.json(
              {
                error: "Persisted proposal line items table is unavailable",
                details:
                  "Apply the Prisma migration for procore_proposal_line_items_live before using persist=true.",
                host,
              },
              { status: 503 }
            );
          }

          throw tableError;
        }
      }

      const persistence = {
        enabled: persist,
        attempted: 0,
        persisted: 0,
        failed: 0,
        errors: [] as string[],
      };

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
        const lineItems: unknown[] = [];
        const projectSummaries: Array<{
          bidBoardProjectId: string;
          proposalCount: number;
          lineItemCount: number;
        }> = [];

        for (const project of limitedBidBoardProjects) {
          const projectRecord = isRecord(project) ? project : {};
          const bidBoardProjectId = String(projectRecord.id || projectRecord.bid_board_project_id || "").trim();
          if (!bidBoardProjectId) continue;
          const projectName = String(projectRecord.name || projectRecord.title || "").trim() || null;
          const customerName = (
            String(projectRecord.customer_name || "").trim() ||
            (isRecord(projectRecord.customer_company)
              ? String(projectRecord.customer_company.name || "").trim()
              : "") ||
            null
          );

          const proposals: unknown[] = [];
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
              proposals.push(...proposalItems);
              if (!fetchAll || proposalItems.length < perPage || proposals.length >= maxProposalsPerProject) break;
              proposalPage += 1;
            } catch (error) {
              const status = Number((error as { status?: number })?.status || 0);
              if (status === 404) break;
              throw error;
            }
          }

          const limitedProposals = proposals.slice(0, maxProposalsPerProject);
          let projectLineItemCount = 0;

          for (const proposal of limitedProposals) {
            const proposalRecord = isRecord(proposal) ? proposal : {};
            const proposalId = String(proposalRecord.id || proposalRecord.proposal_id || "").trim();
            if (!proposalId) continue;
            const proposalName =
              String(proposalRecord.name || proposalRecord.title || proposalRecord.proposal_number || "").trim() || null;

            let lineItemPage = 1;
            while (true) {
              try {
                const lineItemsPayload = await getJson(
                  `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                    bidBoardProjectId
                  )}/proposals/${encodeURIComponent(proposalId)}/line_items?page=${lineItemPage}&per_page=${perPage}`
                );

                const proposalLineItems = asArray(lineItemsPayload, ["data", "line_items", "items"]);
                if (proposalLineItems.length === 0) break;

                for (const item of proposalLineItems) {
                  lineItems.push({
                    bidBoardProjectId,
                    projectName,
                    customerName,
                    proposalId,
                    proposalName,
                    lineItem: item,
                  });

                  if (persist) {
                    persistence.attempted += 1;
                    try {
                      await upsertProposalLineItemLive({
                        companyId,
                        bidBoardProjectId,
                        proposalId,
                        projectName,
                        customerName,
                        proposalName,
                        lineItem: item,
                      });
                      persistence.persisted += 1;
                    } catch (persistError) {
                      if (isMissingTableError(persistError)) {
                        throw persistError;
                      }

                      persistence.failed += 1;
                      if (persistence.errors.length < 25) {
                        const msg = persistError instanceof Error ? persistError.message : String(persistError);
                        persistence.errors.push(`${bidBoardProjectId}/${proposalId}: ${msg}`);
                      }
                    }
                  }
                }

                projectLineItemCount += proposalLineItems.length;

                if (!fetchAll || proposalLineItems.length < perPage || lineItemPage >= maxLineItemsPages) break;
                lineItemPage += 1;
              } catch (error) {
                const status = Number((error as { status?: number })?.status || 0);
                if (status === 404) break;
                throw error;
              }
            }
          }

          projectSummaries.push({
            bidBoardProjectId,
            proposalCount: limitedProposals.length,
            lineItemCount: projectLineItemCount,
          });
        }

        return NextResponse.json({
          success: true,
          source: "estimating.proposal_line_items_bulk",
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
            maxLineItemsPages,
          },
          counts: {
            bidBoardProjectsFetched: bidBoardProjects.length,
            bidBoardProjectsProcessed: limitedBidBoardProjects.length,
            projectSummaries: projectSummaries.length,
            lineItems: lineItems.length,
          },
          persistence,
          projectSummaries,
          lineItems,
        });
      } catch (error) {
        if (persist && isMissingTableError(error)) {
          return NextResponse.json(
            {
              error: "Persisted proposal line items table is unavailable",
              details:
                "Apply the Prisma migration for procore_proposal_line_items_live before using persist=true.",
              host,
            },
            { status: 503 }
          );
        }

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
              error: `Bulk proposal line items API error ${status}`,
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
        error: "Failed to fetch bulk proposal line items",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error: "Persisted proposal line items table is unavailable",
          details:
            "Apply the Prisma migration for procore_proposal_line_items_live before using persist=true.",
        },
        { status: 503 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch bulk proposal line items",
        details: message,
      },
      { status: 500 }
    );
  }
}
