import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return String(value || "").trim();
}

function collectMatchingKeys(value: unknown, patterns: string[]): string[] {
  const found = new Set<string>();

  function walk(current: unknown) {
    if (!current || typeof current !== "object") return;

    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }

    for (const [key, nested] of Object.entries(current as UnknownRecord)) {
      const lower = key.toLowerCase();
      if (patterns.some((pattern) => lower.includes(pattern))) {
        found.add(key);
      }
      walk(nested);
    }
  }

  walk(value);
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

function summarizeEstimatingProject(payload: unknown) {
  if (!isRecord(payload)) return null;

  return {
    id: readString(payload.id || payload.project_id || payload.procore_project_id) || null,
    name: readString(payload.name || payload.project_name || payload.title) || null,
    status: readString(payload.status || payload.project_status || payload.bid_board_status) || null,
    bidBoardProjectId: readString(payload.bid_board_project_id || payload.bid_board_id) || null,
    proposalId: readString(payload.proposal_id || payload.primary_proposal_id) || null,
    hasActiveFields: collectMatchingKeys(payload, ["active"]).length > 0,
    hasPrimaryFields: collectMatchingKeys(payload, ["primary"]).length > 0,
  };
}

async function handleRequest(body: UnknownRecord) {
  const cookieStore = await cookies();

  const bodyToken = readString(body.accessToken);
  const cookieToken = readString(cookieStore.get("procore_access_token")?.value);
  const accessToken = cookieToken || bodyToken;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
      { status: 401 }
    );
  }

  const companyId = readString(
    body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
  );
  const projectId = readString(body.projectId || body.procoreProjectId || body.project_id || body.procore_project_id);
  const requestedBaseUrl = readString(
    body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
  );

  if (!companyId || !projectId) {
    return NextResponse.json(
      { error: "Missing required fields: companyId, projectId" },
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
    )}/projects/${encodeURIComponent(projectId)}/estimating/estimating_project`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Procore-Company-Id": companyId,
      },
      cache: "no-store",
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
          error: `Estimating project API error ${response.status}`,
          details: errorText,
          host,
        },
        { status: response.status }
      );
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const activeFields = collectMatchingKeys(payload, ["active"]);
    const primaryFields = collectMatchingKeys(payload, ["primary"]);

    return NextResponse.json({
      success: true,
      source: "estimating.estimating_project",
      companyId,
      projectId,
      baseUrl: host,
      summary: summarizeEstimatingProject(payload),
      detectedFields: {
        active: activeFields,
        primary: primaryFields,
      },
      raw: payload,
    });
  }

  return NextResponse.json(
    {
      error: "Failed to fetch estimating project",
      details: "All configured hosts failed",
      attempts,
    },
    { status: 404 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const body: UnknownRecord = {
      companyId: request.nextUrl.searchParams.get("companyId") || "",
      projectId:
        request.nextUrl.searchParams.get("projectId") ||
        request.nextUrl.searchParams.get("procoreProjectId") ||
        "",
      baseUrl: request.nextUrl.searchParams.get("baseUrl") || "",
    };

    return await handleRequest(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch estimating project",
        details: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    return await handleRequest(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch estimating project",
        details: message,
      },
      { status: 500 }
    );
  }
}
