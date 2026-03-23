import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unpackFieldSet(payload: unknown): Record<string, unknown> {
  const row = asObject(payload);
  const updatedBy = asObject(row.updated_by);
  const fields = toArray(row.configurable_fields).map((fieldRaw) => {
    const field = asObject(fieldRaw);
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
    const fieldSetId = readText(body?.fieldSetId || body?.id);

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    if (!fieldSetId) {
      return NextResponse.json(
        { success: false, error: "Missing fieldSetId (or id)." },
        { status: 400 }
      );
    }

    const endpoint = `/rest/v1.0/companies/${encodeURIComponent(companyId)}/configurable_field_sets/${encodeURIComponent(fieldSetId)}`;
    const payload = await makeRequest(endpoint, accessToken, undefined, companyId);
    const unpacked = unpackFieldSet(payload);

    return NextResponse.json({
      success: true,
      companyId,
      fieldSetId,
      data: payload,
      unpacked,
      raw: payload,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch configurable field set by id", details: message },
      { status: 500 }
    );
  }
}
