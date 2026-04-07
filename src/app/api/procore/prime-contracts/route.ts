import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseCsv(input: unknown): string[] {
  const text = readText(input);
  if (!text) return [];
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function toNullableDate(value: unknown): Date | null {
  const text = readText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeContractDate(record: Record<string, unknown>): Date | null {
  return (
    toNullableDate(record.signed_contract_received_date) ||
    toNullableDate(record.contract_date) ||
    toNullableDate(record.execution_date)
  );
}

async function ensurePrimeContractsLiveTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_prime_contracts_live (
      prime_contract_id TEXT PRIMARY KEY,
      company_id TEXT,
      project_id TEXT,
      project_procore_id TEXT,
      number TEXT,
      title TEXT,
      status TEXT,
      contract_date TIMESTAMPTZ,
      signed_contract_received_date TIMESTAMPTZ,
      execution_date TIMESTAMPTZ,
      contract_start_date TIMESTAMPTZ,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_prime_contracts_live_project_id_idx
      ON procore_prime_contracts_live (project_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_prime_contracts_live_project_procore_id_idx
      ON procore_prime_contracts_live (project_procore_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_prime_contracts_live_synced_at_idx
      ON procore_prime_contracts_live (synced_at DESC)
  `);
}

async function upsertPrimeContractLive(params: {
  companyId: string;
  projectId: string;
  record: Record<string, unknown>;
}) {
  const { companyId, projectId, record } = params;

  const primeContractId = readText(record.id);
  if (!primeContractId) return;

  const contractDate = toNullableDate(record.contract_date);
  const signedContractDate = toNullableDate(record.signed_contract_received_date);
  const executionDate = toNullableDate(record.execution_date);
  const contractStartDate = toNullableDate(record.contract_start_date);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_prime_contracts_live
        (prime_contract_id, company_id, project_id, project_procore_id, number, title, status,
         contract_date, signed_contract_received_date, execution_date, contract_start_date, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12::jsonb, NOW())
      ON CONFLICT (prime_contract_id)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        project_id = EXCLUDED.project_id,
        project_procore_id = EXCLUDED.project_procore_id,
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        contract_date = EXCLUDED.contract_date,
        signed_contract_received_date = EXCLUDED.signed_contract_received_date,
        execution_date = EXCLUDED.execution_date,
        contract_start_date = EXCLUDED.contract_start_date,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    primeContractId,
    companyId,
    projectId,
    projectId,
    readText(record.number) || null,
    readText(record.title) || null,
    readText(record.status) || null,
    contractDate,
    signedContractDate,
    executionDate,
    contractStartDate,
    JSON.stringify(record)
  );
}

async function updateProjectContractDate(params: {
  projectId: string;
  records: Record<string, unknown>[];
}) {
  const { projectId, records } = params;

  const best = records
    .map((record) => ({
      record,
      normalized: normalizeContractDate(record),
      updatedAt: toNullableDate(record.updated_at),
    }))
    .sort((a, b) => {
      const bNorm = b.normalized ? b.normalized.getTime() : 0;
      const aNorm = a.normalized ? a.normalized.getTime() : 0;
      if (bNorm !== aNorm) return bNorm - aNorm;
      const bUpd = b.updatedAt ? b.updatedAt.getTime() : 0;
      const aUpd = a.updatedAt ? a.updatedAt.getTime() : 0;
      return bUpd - aUpd;
    })[0];

  if (!best) return;

  const normalizedContractDate = best.normalized;
  const contractStartDate = toNullableDate(best.record.contract_start_date);
  const primeContractId = readText(best.record.id) || null;

  const project = await prisma.project.findFirst({
    where: {
      OR: [
        { procoreId: projectId },
        { customFields: { path: ["procoreId"], equals: projectId } },
        { customFields: { path: ["procoreProjectId"], equals: projectId } },
      ],
    },
    select: { id: true, customFields: true },
  });

  if (!project) return;

  const existingCustomFields =
    project.customFields && typeof project.customFields === "object" && !Array.isArray(project.customFields)
      ? (project.customFields as Record<string, unknown>)
      : {};

  await prisma.project.update({
    where: { id: project.id },
    data: {
      customFields: {
        ...existingCustomFields,
        procorePrimeContractId: primeContractId,
        contractDate: normalizedContractDate ? normalizedContractDate.toISOString() : null,
        contractStartDate: contractStartDate ? contractStartDate.toISOString() : null,
        contractDateSource: "procore_prime_contracts",
        contractDateSyncedAt: new Date().toISOString(),
      },
    },
  });
}

async function fetchPrimeContracts(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  page?: number;
  perPage?: number;
  filterIds?: string[];
  filterUpdatedAt?: string;
  persist?: boolean;
}) {
  const {
    accessToken,
    companyId,
    projectId,
    page = 1,
    perPage = 100,
    filterIds = [],
    filterUpdatedAt,
    persist = false,
  } = params;

  const qs = new URLSearchParams();
  qs.set("project_id", projectId);
  qs.set("page", String(Number.isFinite(page) ? page : 1));
  qs.set("per_page", String(Number.isFinite(perPage) ? perPage : 100));

  if (filterIds.length > 0) {
    // Repeat filters[id][] entries for compatibility with array-style filters
    for (const id of filterIds) qs.append("filters[id][]", id);
  }
  if (readText(filterUpdatedAt)) {
    qs.set("filters[updated_at]", String(filterUpdatedAt));
  }

  const endpoint = `/rest/v1.0/prime_contracts?${qs.toString()}`;
  const data = await makeRequest(endpoint, accessToken, undefined, companyId);

  if (persist && Array.isArray(data)) {
    await ensurePrimeContractsLiveTable();
    const records = data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");

    for (const record of records) {
      await upsertPrimeContractLive({ companyId, projectId, record });
    }

    await updateProjectContractDate({ projectId, records });
  }

  return {
    success: true,
    companyId,
    projectId,
    page,
    perPage,
    filterIds,
    filterUpdatedAt: filterUpdatedAt || null,
    persisted: persist,
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
    const filterIds = parseCsv(searchParams.get("filterIds") || searchParams.get("filters[id]"));
    const filterUpdatedAt = readText(searchParams.get("filterUpdatedAt") || searchParams.get("filters[updated_at]"));
    const persist = ["1", "true", "yes"].includes(readText(searchParams.get("persist")).toLowerCase());

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

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId." }, { status: 400 });
    }

    const payload = await fetchPrimeContracts({
      accessToken,
      companyId,
      projectId,
      page,
      perPage,
      filterIds,
      filterUpdatedAt,
      persist,
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch prime contracts", details: message },
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
    const filterIds = Array.isArray(body?.filterIds)
      ? body.filterIds.map((v: unknown) => String(v).trim()).filter(Boolean)
      : parseCsv(body?.filterIds);
    const filterUpdatedAt = readText(body?.filterUpdatedAt);
    const persist = body?.persist === undefined ? false : Boolean(body?.persist);

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId." }, { status: 400 });
    }

    const payload = await fetchPrimeContracts({
      accessToken,
      companyId,
      projectId,
      page,
      perPage,
      filterIds,
      filterUpdatedAt,
      persist,
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch prime contracts", details: message },
      { status: 500 }
    );
  }
}
