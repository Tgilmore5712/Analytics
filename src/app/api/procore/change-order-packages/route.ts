import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates, getPrimaryAllowedProcoreOrigin } from "@/lib/procoreHosts";

export const dynamic = "force-dynamic";

type PrimeContractRecord = {
  id?: number | string;
  title?: string;
  number?: string;
  status?: string;
  contract_date?: string;
  signed_contract_received_date?: string;
  execution_date?: string;
  updated_at?: string;
};

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseCsv(input: unknown): string[] {
  const text = readText(input);
  if (!text) return [];
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function toSafePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function toUnixScore(value: unknown): number {
  const text = readText(value);
  if (!text) return 0;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function choosePrimeContract(records: PrimeContractRecord[]): PrimeContractRecord | null {
  if (!records.length) return null;

  const ranked = [...records].sort((a, b) => {
    const bDate = Math.max(
      toUnixScore(b.signed_contract_received_date),
      toUnixScore(b.contract_date),
      toUnixScore(b.execution_date),
      toUnixScore(b.updated_at)
    );
    const aDate = Math.max(
      toUnixScore(a.signed_contract_received_date),
      toUnixScore(a.contract_date),
      toUnixScore(a.execution_date),
      toUnixScore(a.updated_at)
    );
    return bDate - aDate;
  });

  return ranked[0] || null;
}

async function resolvePrimeContractId(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}): Promise<{ contractId: string; source: string; contract: PrimeContractRecord }> {
  const query = new URLSearchParams({
    project_id: params.projectId,
    page: "1",
    per_page: "100",
  });

  const primeContractsData = await makeRequest(
    `/rest/v1.0/prime_contracts?${query.toString()}`,
    params.accessToken,
    { method: "GET", cache: "no-store" },
    params.companyId
  );

  const contracts = Array.isArray(primeContractsData)
    ? (primeContractsData as PrimeContractRecord[])
    : [];

  const chosen = choosePrimeContract(contracts);
  const contractId = readText(chosen?.id);

  if (!contractId) {
    throw new Error("No prime contract found for project. Provide contractId explicitly.");
  }

  return {
    contractId,
    source: "prime_contracts",
    contract: chosen as PrimeContractRecord,
  };
}

async function fetchChangeOrderPackages(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  page: number;
  perPage: number;
  statusFilters: string[];
  updatedAtFilter: string;
  idFilters: string[];
}) {
  const query = new URLSearchParams({
    project_id: params.projectId,
    contract_id: params.contractId,
    page: String(params.page),
    per_page: String(params.perPage),
  });

  for (const status of params.statusFilters) {
    query.append("filters[status][]", status);
  }

  if (params.updatedAtFilter) {
    query.set("filters[updated_at]", params.updatedAtFilter);
  }

  for (const id of params.idFilters) {
    query.append("filters[id][]", id);
  }

  const data = await makeRequest(
    `/rest/v1.0/change_order_packages?${query.toString()}`,
    params.accessToken,
    { method: "GET", cache: "no-store" },
    params.companyId,
    [404]
  );

  const packages = Array.isArray(data) ? data : [];

  return {
    success: true,
    source: "change_order_packages",
    companyId: params.companyId,
    projectId: params.projectId,
    contractId: params.contractId,
    page: params.page,
    perPage: params.perPage,
    statusFilters: params.statusFilters,
    updatedAtFilter: params.updatedAtFilter || null,
    idFilters: params.idFilters,
    count: packages.length,
    data: packages,
  };
}

async function handleRequest(input: {
  accessToken: string;
  companyId: string;
  projectId: string;
  contractId: string;
  page: number;
  perPage: number;
  statusFilters: string[];
  updatedAtFilter: string;
  idFilters: string[];
}) {
  if (!input.accessToken) {
    return NextResponse.json(
      { error: "Missing access token. Please authenticate via OAuth first." },
      { status: 401 }
    );
  }

  if (!input.companyId) {
    return NextResponse.json(
      { error: "Missing companyId. Provide it explicitly or set PROCORE_COMPANY_ID." },
      { status: 400 }
    );
  }

  if (!input.projectId) {
    return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
  }

  try {
    let resolvedContractId = input.contractId;
    let contractResolutionSource = "request";
    let resolvedContract: PrimeContractRecord | null = null;

    if (!resolvedContractId) {
      const resolved = await resolvePrimeContractId({
        accessToken: input.accessToken,
        companyId: input.companyId,
        projectId: input.projectId,
      });
      resolvedContractId = resolved.contractId;
      contractResolutionSource = resolved.source;
      resolvedContract = resolved.contract;
    }

    const response = await fetchChangeOrderPackages({
      accessToken: input.accessToken,
      companyId: input.companyId,
      projectId: input.projectId,
      contractId: resolvedContractId,
      page: input.page,
      perPage: input.perPage,
      statusFilters: input.statusFilters,
      updatedAtFilter: input.updatedAtFilter,
      idFilters: input.idFilters,
    });

    return NextResponse.json({
      ...response,
      contractResolutionSource,
      resolvedContract: resolvedContract
        ? {
            id: resolvedContract.id ?? null,
            number: resolvedContract.number ?? null,
            title: resolvedContract.title ?? null,
            status: resolvedContract.status ?? null,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = Number((error as { status?: number })?.status || 0);

    return NextResponse.json(
      {
        error: "Failed to fetch change order packages",
        details: message,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const { searchParams } = new URL(request.url);
  const authHeader = readText(request.headers.get("authorization"));
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const accessToken = readText(
    searchParams.get("accessToken") || bearerToken || cookieStore.get("procore_access_token")?.value
  );
  const companyId = readText(
    searchParams.get("companyId") || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId
  );

  return handleRequest({
    accessToken,
    companyId,
    projectId: readText(searchParams.get("projectId")),
    contractId: readText(searchParams.get("contractId")),
    page: toSafePositiveInt(searchParams.get("page"), 1, 200),
    perPage: toSafePositiveInt(searchParams.get("perPage"), 100, 200),
    statusFilters: parseCsv(searchParams.get("status")),
    updatedAtFilter: readText(searchParams.get("updatedAt")),
    idFilters: parseCsv(searchParams.get("ids")),
  });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const authHeader = readText(request.headers.get("authorization"));
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const hostCandidates = buildAllowedProcoreHostCandidates({
    requestedOrigin: body.baseUrl,
    extraOrigins: [procoreConfig.apiUrl],
  });

  if (hostCandidates.error) {
    return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
  }

  // The request helper reads the configured API URL; host validation is retained for consistency with other routes.
  const _validatedBaseUrl = hostCandidates.candidates[0] || getPrimaryAllowedProcoreOrigin(procoreConfig.apiUrl);
  void _validatedBaseUrl;

  const accessToken = readText(body.accessToken || bearerToken || cookieStore.get("procore_access_token")?.value);
  const companyId = readText(
    body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId
  );

  return handleRequest({
    accessToken,
    companyId,
    projectId: readText(body.projectId),
    contractId: readText(body.contractId),
    page: toSafePositiveInt(body.page, 1, 200),
    perPage: toSafePositiveInt(body.perPage, 100, 200),
    statusFilters: parseCsv(body.status),
    updatedAtFilter: readText(body.updatedAt),
    idFilters: parseCsv(body.ids),
  });
}
