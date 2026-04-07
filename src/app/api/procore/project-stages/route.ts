import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

async function fetchProjectStages(params: {
  accessToken: string;
  companyId: string;
  projectId?: string;
  page?: number;
  perPage?: number;
}) {
  const { accessToken, companyId, projectId, page = 1, perPage = 100 } = params;

  const qs = new URLSearchParams();
  qs.set("page", String(Number.isFinite(page) ? page : 1));
  qs.set("per_page", String(Number.isFinite(perPage) ? perPage : 100));
  if (projectId) qs.set("project_id", projectId);

  const endpoint = `/rest/v1.0/companies/${encodeURIComponent(companyId)}/project_stages?${qs.toString()}`;
  const data = await makeRequest(endpoint, accessToken, undefined, companyId);

  return {
    success: true,
    companyId,
    projectId: projectId || null,
    page,
    perPage,
    count: Array.isArray(data) ? data.length : null,
    data,
  };
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const { searchParams } = new URL(request.url);
    const authHeader = readText(request.headers.get("authorization"));
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const accessToken = readText(
      searchParams.get("accessToken") ||
        bearerToken ||
        cookieStore.get("procore_access_token")?.value
    );

    const companyId = readText(
      searchParams.get("companyId") ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );
    const projectId = readText(searchParams.get("projectId"));
    const page = Number(searchParams.get("page") || 1);
    const perPage = Number(searchParams.get("perPage") || 100);

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing access token. Provide OAuth cookie, Authorization: Bearer <token>, or ?accessToken=...",
        },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const payload = await fetchProjectStages({ accessToken, companyId, projectId, page, perPage });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch project stages", details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const cookieStore = await cookies();
    const accessToken = readText(cookieStore.get("procore_access_token")?.value || body?.accessToken);
    const companyId = readText(
      body?.companyId ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );
    const projectId = readText(body?.projectId);
    const page = Number(body?.page || 1);
    const perPage = Number(body?.perPage || 100);

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const payload = await fetchProjectStages({ accessToken, companyId, projectId, page, perPage });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch project stages", details: message },
      { status: 500 }
    );
  }
}
