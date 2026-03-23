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

function unwrapItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.results)) return obj.results;
  }
  return [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toLower(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function findValuePaths(params: {
  node: unknown;
  needle: string;
  path?: string;
  maxMatches?: number;
}): Array<{ path: string; value: string }> {
  const { node, needle, path = "$", maxMatches = 10000 } = params;
  const matches: Array<{ path: string; value: string }> = [];
  const target = toLower(needle);

  function walk(current: unknown, currentPath: string) {
    if (matches.length >= maxMatches) return;

    if (current == null) return;

    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
      const text = String(current);
      if (text.toLowerCase().includes(target)) {
        matches.push({ path: currentPath, value: text });
      }
      return;
    }

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i += 1) {
        walk(current[i], `${currentPath}[${i}]`);
        if (matches.length >= maxMatches) return;
      }
      return;
    }

    if (typeof current === "object") {
      const obj = current as Record<string, unknown>;
      for (const [key, value] of Object.entries(obj)) {
        const safeKey = key.match(/^[A-Za-z_][A-Za-z0-9_]*$/) ? `.${key}` : `["${key}"]`;
        walk(value, `${currentPath}${safeKey}`);
        if (matches.length >= maxMatches) return;
      }
    }
  }

  if (!target) return matches;
  walk(node, path);
  return matches;
}

async function fetchFieldSetDetail(params: {
  companyId: string;
  accessToken: string;
  fieldSetId: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const endpoint = `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/configurable_field_sets/${encodeURIComponent(params.fieldSetId)}`;
    const payload = await makeRequest(endpoint, params.accessToken, undefined, params.companyId, [404]);
    return asObject(payload);
  } catch {
    return null;
  }
}

function unpackFieldSet(item: unknown): Record<string, unknown> {
  const row = asObject(item);
  const updatedBy = asObject(row.updated_by);
  const fields = toArray(row.configurable_fields).map((f) => {
    const field = asObject(f);
    return {
      id: field.id ?? null,
      name: field.name ?? null,
      kind: field.kind ?? null,
      fieldType: field.field_type ?? field.type ?? null,
      position: field.position ?? null,
      required: field.required ?? null,
      optionsCount: toArray(field.options).length,
      options: toArray(field.options),
    };
  });

  const projects = toArray(row.projects).map((projectRaw) => {
    const project = asObject(projectRaw);
    return {
      id: project.id ?? null,
      name: project.name ?? null,
    };
  });

  return {
    id: row.id ?? null,
    name: row.name ?? null,
    category: row.category ?? null,
    type: row.type ?? null,
    source: row.source ?? null,
    deletable: row.deletable ?? null,
    updatedAt: row.updated_at ?? null,
    updatedBy: {
      id: updatedBy.id ?? null,
      login: updatedBy.login ?? null,
      name: updatedBy.name ?? null,
    },
    inspectionTypeId: row.inspection_type_id ?? null,
    genericToolId: row.generic_tool_id ?? null,
    actionPlanTypeId: row.action_plan_type_id ?? null,
    observationsCategoryId: row.observations_category_id ?? null,
    projectsCount: projects.length,
    projects,
    configurableFieldCount: fields.length,
    configurableFields: fields,
  };
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

    const page = toPositiveInt(body?.page, 1, 1, 1000);
    const perPage = toPositiveInt(body?.perPage, 100, 1, 1000);
    const searchValue = readText(body?.searchValue);
    const maxSearchMatches = toPositiveInt(body?.maxSearchMatches, 10000, 1, 50000);

    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });

    const endpoint = `/rest/v1.0/companies/${encodeURIComponent(companyId)}/configurable_field_sets?${qs.toString()}`;
    const payload = await makeRequest(endpoint, accessToken, undefined, companyId);
    const items = unwrapItems(payload);

    const detailedItems = await Promise.all(
      items.map(async (item) => {
        const row = asObject(item);
        const id = readText(row.id);
        if (!id) return row;
        const detail = await fetchFieldSetDetail({ companyId, accessToken, fieldSetId: id });
        return detail || row;
      })
    );

    const unpacked = detailedItems.map((item) => unpackFieldSet(item));

    const searchResults = searchValue
      ? detailedItems
          .map((item, index) => {
            const row = asObject(item);
            const rowId = row.id ?? null;
            const rowName = row.name ?? null;
            const matches = findValuePaths({ node: item, needle: searchValue, maxMatches: maxSearchMatches });
            return {
              index,
              id: rowId,
              name: rowName,
              matches,
              matchCount: matches.length,
            };
          })
          .filter((r) => r.matchCount > 0)
      : [];

    const totalMatchCount = searchResults.reduce((sum, r) => sum + r.matchCount, 0);

    return NextResponse.json({
      success: true,
      companyId,
      page,
      perPage,
      searchValue: searchValue || null,
      count: items.length,
      data: detailedItems,
      unpacked,
      searchResults,
      totalMatchCount,
      raw: payload,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch available configurable field sets", details: message },
      { status: 500 }
    );
  }
}
