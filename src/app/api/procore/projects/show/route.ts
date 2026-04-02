import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { makeRequest, procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";
import { unpackProjectPayload } from "@/lib/procoreProjectPayloadUnpack";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

interface ProcoreProject {
  id: string;
  name?: string;
  display_name?: string;
  project_number?: string;
  project_owner_type?: {
    id: string;
    name: string;
  };
  status?: string;
  created_at?: string | Date;
  updated_at?: string | Date;
  [key: string]: unknown;
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
    const projectId = readText(body?.projectId || body?.id);
    const view = readText(body?.view).toLowerCase() === "minimal" ? "minimal" : "full";

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId (or id)." }, { status: 400 });
    }

    const qs = new URLSearchParams({ company_id: companyId });
    if (view === "minimal") {
      qs.set("view", "minimal");
    }

    const endpoint = `/rest/v1.0/projects/${encodeURIComponent(projectId)}?${qs.toString()}`;
    const rawPayload = await makeRequest(endpoint, accessToken, undefined, companyId);
    const payload = rawPayload as ProcoreProject;
    const payloadJson = payload as Prisma.InputJsonValue;

    // Extract key fields for indexed queries
    const projectOwnerType = payload?.project_owner_type?.name ?? null;
    const projectOwnerTypeId = payload?.project_owner_type?.id ?? null;
    const createdAt = payload?.created_at ? new Date(payload.created_at) : null;
    const updatedAt = payload?.updated_at ? new Date(payload.updated_at) : null;

    // Store in database (create or update)
    try {
      // Check if record exists
      const existing = await prisma.procoreProjectStaging.findFirst({
        where: {
          companyId: companyId,
          projectId: projectId,
        },
      });

      if (existing) {
        // Update existing record
        await prisma.procoreProjectStaging.update({
          where: { id: existing.id },
          data: {
            name: payload?.name ?? null,
            displayName: payload?.display_name ?? null,
            projectNumber: payload?.project_number ?? null,
            projectOwnerType,
            projectOwnerTypeId,
            status: payload?.status ?? null,
            createdAt,
            updatedAt,
            payload: payloadJson,
            syncedAt: new Date(),
          },
        });
      } else {
        // Create new record
        await prisma.procoreProjectStaging.create({
          data: {
            companyId,
            projectId,
            name: payload?.name ?? null,
            displayName: payload?.display_name ?? null,
            projectNumber: payload?.project_number ?? null,
            projectOwnerType,
            projectOwnerTypeId,
            status: payload?.status ?? null,
            createdAt,
            updatedAt,
            payload: payloadJson,
          },
        });
      }

      // Unpack the payload into queryable fields
      await unpackProjectPayload(companyId, projectId, projectId, payload);
    } catch (dbError) {
      console.error("Database save error:", dbError);
      // Log but don't fail the request - still return the payload to user
    }

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      view,
      data: payload,
      raw: payload,
      stored: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch project payload", details: message },
      { status: 500 }
    );
  }
}
