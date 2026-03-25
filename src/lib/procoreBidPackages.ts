import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureBidPackagesTable() {
  return;
}

export async function upsertBidPackage(params: {
  companyId: string;
  projectId: string;
  bidPackageId: string;
  name?: string | null;
  status?: string | null;
  sourceCreatedAt?: string | Date | null;
  payload: JsonObject;
}) {
  const {
    companyId,
    projectId,
    bidPackageId,
    name,
    status,
    sourceCreatedAt,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO bidpackages (
        company_id,
        project_id,
        bid_package_id,
        name,
        status,
        source_created_at,
        payload,
        synced_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, NOW(), NOW())
      ON CONFLICT (company_id, project_id, bid_package_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        source_created_at = EXCLUDED.source_created_at,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    bidPackageId,
    name ?? null,
    status ?? null,
    normalizeTimestamp(sourceCreatedAt),
    JSON.stringify(payload)
  );
}
