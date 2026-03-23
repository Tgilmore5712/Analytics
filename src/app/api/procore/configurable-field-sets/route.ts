import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toBoolString(value: unknown, fallback: boolean): string {
  const text = readText(value).toLowerCase();
  if (text === "true" || text === "1") return "true";
  if (text === "false" || text === "0") return "false";
  return fallback ? "true" : "false";
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => readText(v)).filter((v) => v.length > 0);
  }
  const text = readText(value);
  if (!text) return [];
  return text.split(",").map((v) => v.trim()).filter((v) => v.length > 0);
}

function unwrapItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.results)) return obj.results;
  }
  return [];
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

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    const projectId = readText(body?.projectId);
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId" }, { status: 400 });
    }

    const page = toPositiveInt(body?.page, 1, 1, 1000);
    const perPage = toPositiveInt(body?.perPage, 100, 1, 1000);
    const includeLovEntries = toBoolString(body?.includeLovEntries, true);
    const includeDefaultConfigurableFieldSets = toBoolString(body?.includeDefaultConfigurableFieldSets, true);
    const types = toStringArray(body?.types);

    const genericToolId = readText(body?.genericToolId);
    const actionPlanTypeId = readText(body?.actionPlanTypeId);
    const inspectionTypeId = readText(body?.inspectionTypeId);
    const observationsCategoryId = readText(body?.observationsCategoryId);
    const category = readText(body?.category);

    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      include_lov_entries: includeLovEntries,
      include_default_configurable_field_sets: includeDefaultConfigurableFieldSets,
    });

    for (const t of types) {
      qs.append("types[]", t);
    }

    if (genericToolId) qs.set("generic_tool_id", genericToolId);
    if (actionPlanTypeId) qs.set("action_plan_type_id", actionPlanTypeId);
    if (inspectionTypeId) qs.set("inspection_type_id", inspectionTypeId);
    if (observationsCategoryId) qs.set("observations_category_id", observationsCategoryId);
    if (category) qs.set("category", category);

    const endpoint = `/rest/v1.0/projects/${encodeURIComponent(projectId)}/configurable_field_sets?${qs.toString()}`;
    const payload = await makeRequest(endpoint, accessToken, undefined, companyId);
    const items = unwrapItems(payload);

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      page,
      perPage,
      includeLovEntries: includeLovEntries === "true",
      includeDefaultConfigurableFieldSets: includeDefaultConfigurableFieldSets === "true",
      types,
      count: items.length,
      data: items,
      raw: payload,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch configurable field sets", details: message },
      { status: 500 }
    );
  }
}
