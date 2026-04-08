import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseIds(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim()).filter(Boolean);
  }
  const text = readText(input);
  if (!text) return [];
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveCompanyId(input: unknown, cookieCompanyId: unknown): string {
  return readText(
    input ||
      cookieCompanyId ||
      procoreConfig.companyId ||
      process.env.PROCORE_COMPANY_ID ||
      process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID ||
      ""
  );
}

async function checkIds(params: { accessToken: string; companyId: string; ids: string[] }) {
  const { accessToken, companyId, ids } = params;

  const results: Array<{
    id: string;
    exists: boolean;
    httpStatus: number;
    projectName?: string | null;
    displayName?: string | null;
    projectNumber?: string | null;
    stage?: string | null;
    active?: boolean | null;
    updatedAt?: string | null;
    error?: unknown;
  }> = [];

  for (const id of ids) {
    const endpoint = `/rest/v1.0/projects/${encodeURIComponent(id)}?company_id=${encodeURIComponent(companyId)}`;
    try {
      const data = await makeRequest(endpoint, accessToken, undefined, companyId);
      const row = data as {
        name?: string;
        display_name?: string;
        project_number?: string;
        stage?: string;
        project_stage?: { name?: string };
        active?: boolean;
        updated_at?: string;
      };

      results.push({
        id,
        exists: true,
        httpStatus: 200,
        projectName: row.name || row.display_name || null,
        displayName: row.display_name || null,
        projectNumber: row.project_number || null,
        stage: row.stage || row.project_stage?.name || null,
        active: typeof row.active === "boolean" ? row.active : null,
        updatedAt: row.updated_at || null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
      const httpStatus = statusMatch ? Number.parseInt(statusMatch[1], 10) : 500;

      results.push({
        id,
        exists: false,
        httpStatus,
        error: message,
      });
    }
  }

  return results;
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const { searchParams } = new URL(request.url);

    const accessToken = readText(cookieStore.get("procore_access_token")?.value);
    const companyId = resolveCompanyId(searchParams.get("companyId"), cookieStore.get("procore_company_id")?.value);
    const ids = parseIds(searchParams.get("ids"));

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please login via OAuth." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "Provide IDs in query param: ?ids=1,2,3" },
        { status: 400 }
      );
    }

    const results = await checkIds({ accessToken, companyId, ids });
    return NextResponse.json({ success: true, companyId, count: results.length, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to check project IDs", details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const accessToken = readText(cookieStore.get("procore_access_token")?.value || body?.accessToken);
    const companyId = resolveCompanyId(body?.companyId, cookieStore.get("procore_company_id")?.value);
    const ids = parseIds(body?.ids);

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please login via OAuth." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "Provide IDs in body: { ids: [\"1\", \"2\"] }" },
        { status: 400 }
      );
    }

    const results = await checkIds({ accessToken, companyId, ids });
    return NextResponse.json({ success: true, companyId, count: results.length, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to check project IDs", details: message },
      { status: 500 }
    );
  }
}
