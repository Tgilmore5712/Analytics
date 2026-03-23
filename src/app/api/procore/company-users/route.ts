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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function displayName(user: Record<string, unknown>): string {
  const name = readText(user.name);
  if (name) return name;

  const first = readText(user.first_name);
  const last = readText(user.last_name);
  const full = `${first} ${last}`.trim();
  if (full) return full;

  return readText(user.login) || "-";
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
    const search = readText(body?.search);

    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });

    if (search) {
      qs.set("filters[search]", search);
    }

    const endpoint = `/rest/v1.0/companies/${encodeURIComponent(companyId)}/users?${qs.toString()}`;
    const payload = await makeRequest(endpoint, accessToken, undefined, companyId);

    const users = asArray(payload).map((item) => {
      const user = asObject(item);
      return {
        id: user.id ?? null,
        login: readText(user.login) || null,
        name: displayName(user),
        company_name: readText(user.company_name) || null,
      };
    });

    return NextResponse.json({
      success: true,
      companyId,
      page,
      perPage,
      search: search || null,
      count: users.length,
      data: users,
      raw: payload,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch company users", details: message },
      { status: 500 }
    );
  }
}
