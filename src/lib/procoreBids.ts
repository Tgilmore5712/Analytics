import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureBidsTable() {
  return;
}

export async function upsertBid(params: {
  companyId: string;
  projectId: string;
  bidId: string;
  name?: string | null;
  status?: string | null;
  createdBy?: string | null;
  sourceCreatedAt?: string | Date | null;
  payload: JsonObject;
}) {
  const { companyId, projectId, bidId, name, status, createdBy, sourceCreatedAt, payload } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO bids (
        company_id,
        project_id,
        bid_id,
        name,
        status,
        created_by,
        source_created_at,
        payload,
        synced_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb, NOW(), NOW())
      ON CONFLICT (company_id, project_id, bid_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        created_by = EXCLUDED.created_by,
        source_created_at = EXCLUDED.source_created_at,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    bidId,
    name ?? null,
    status ?? null,
    createdBy ?? null,
    normalizeTimestamp(sourceCreatedAt),
    JSON.stringify(payload)
  );
}
