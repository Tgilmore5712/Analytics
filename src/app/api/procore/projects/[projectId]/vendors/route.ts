import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import {
  ensureProcoreProjectVendorsTable,
  softDeleteProjectVendorsNotInSet,
  toProjectVendorRow,
  upsertProcoreProjectVendor,
} from "@/lib/procoreProjectVendors";

type RouteParams = {
  params: Promise<{
    projectId: string;
  }>;
};

function buildPassthroughQuery(searchParams: URLSearchParams): string {
  const params = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    if (!value || key === "projectId") continue;
    params.append(key, value);
  }

  return params.toString();
}

function getBearerTokenFromHeader(request: Request): string | null {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { projectId } = await params;

    if (!projectId?.trim()) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const companyIdFromUrl = searchParams.get("companyId");
    const companyId = String(companyIdFromUrl || procoreConfig.companyId || '').trim();

    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value?.trim();
    const headerToken = getBearerTokenFromHeader(request);
    const accessToken = cookieToken || headerToken || "";

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in query string." },
        { status: 400 }
      );
    }

    const query = buildPassthroughQuery(searchParams);
    const basePath = `/projects/${encodeURIComponent(projectId)}/vendors`;
    const endpointV11 = `/rest/v1.1${basePath}${query ? `?${query}` : ""}`;

    await ensureProcoreProjectVendorsTable();

    try {
      const vendors = await makeRequest(endpointV11, accessToken, undefined, companyId, [404]);
      const vendorArray = Array.isArray(vendors) ? vendors : [];
      const seenVendorIds = new Set<string>();

      for (const vendor of vendorArray) {
        const row = toProjectVendorRow(companyId, projectId, vendor);
        if (!row) continue;

        await upsertProcoreProjectVendor(row);
        seenVendorIds.add(row.procoreVendorId);
      }

      await softDeleteProjectVendorsNotInSet(companyId, projectId, [...seenVendorIds]);

      return NextResponse.json({
        success: true,
        projectId,
        companyId,
        apiVersion: "v1.1",
        persisted: vendorArray.length,
        vendors: vendorArray,
      });
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 0);
      const message = error instanceof Error ? error.message : String(error);
      const is404 = status === 404 || /(?:^|\D)404(?:\D|$)/.test(message);

      if (!is404) throw error;

      const endpointV10 = `/rest/v1.0${basePath}${query ? `?${query}` : ""}`;
      const vendors = await makeRequest(endpointV10, accessToken, undefined, companyId);
      const vendorArray = Array.isArray(vendors) ? vendors : [];
      const seenVendorIds = new Set<string>();

      for (const vendor of vendorArray) {
        const row = toProjectVendorRow(companyId, projectId, vendor);
        if (!row) continue;

        await upsertProcoreProjectVendor(row);
        seenVendorIds.add(row.procoreVendorId);
      }

      await softDeleteProjectVendorsNotInSet(companyId, projectId, [...seenVendorIds]);

      return NextResponse.json({
        success: true,
        projectId,
        companyId,
        apiVersion: "v1.0",
        persisted: vendorArray.length,
        vendors: vendorArray,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore project vendors API error:", message);

    return NextResponse.json(
      { error: "Failed to fetch Procore project vendors", details: message },
      { status: 500 }
    );
  }
}
