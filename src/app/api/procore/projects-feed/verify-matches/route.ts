import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

function normalizeId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

export async function POST(request: Request) {
  try {
    await ensureProcoreProjectFeedTable();

    const body = await request.json().catch(() => ({}));
    const companyId = String(body?.companyId || '').trim();
    const rematchAll = body?.rematchAll === true;
    const requestedLimit = Number(body?.limit || 500);
    const limit = Math.min(5000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 500));

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (companyId) {
      conditions.push(`company_id = $${p++}`);
      params.push(companyId);
    }

    if (!rematchAll) {
      conditions.push('linked_project_id IS NULL');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const candidates = await prisma.$queryRawUnsafe<Array<{
      id: unknown;
      external_id: string;
      procore_id: string | null;
      project_number: string | null;
      project_name: string;
      customer: string | null;
    }>>(
      `
        SELECT id, external_id, procore_id, project_number, project_name, customer
        FROM procore_project_feed
        ${whereClause}
        ORDER BY synced_at DESC
        LIMIT $${p++}
      `,
      ...params,
      limit
    );

    let matched = 0;
    let unmatched = 0;
    let unmatchedMissingProcoreId = 0;
    let unmatchedNoProjectByProcoreId = 0;
    const errors: string[] = [];
    const unmatchedSamples: Array<{
      feedId: string;
      projectName: string;
      externalId: string;
      procoreId: string | null;
      reason: string;
    }> = [];

    for (const row of candidates) {
      try {
        const procoreIdToMatch = (row.procore_id || row.external_id || '').trim();

        if (!procoreIdToMatch) {
          unmatched += 1;
          unmatchedMissingProcoreId += 1;
          if (unmatchedSamples.length < 50) {
            unmatchedSamples.push({
              feedId: normalizeId(row.id),
              projectName: row.project_name,
              externalId: row.external_id,
              procoreId: row.procore_id,
              reason: 'missing_procore_identity',
            });
          }
          continue;
        }

        const byProcore = await prisma.project.findFirst({
          where: {
            OR: [
              { procoreId: procoreIdToMatch },
              { bidBoardId: row.external_id },
              { customFields: { path: ['procoreId'], equals: procoreIdToMatch } },
              { customFields: { path: ['bidBoardId'], equals: row.external_id } },
            ],
          },
          select: { id: true },
        });

        const matchedProjectId = byProcore?.id || null;
        const confidence: 'high' | 'medium' | null = byProcore?.id ? 'high' : null;

        if (matchedProjectId) {
          await prisma.$executeRawUnsafe(
            `
              UPDATE procore_project_feed
              SET linked_project_id = $1,
                  match_confidence = $2,
                  matched_at = NOW(),
                  updated_at = NOW()
              WHERE id = $3
            `,
            matchedProjectId,
            confidence,
            row.id
          );
          matched += 1;
        } else {
          unmatched += 1;
          unmatchedNoProjectByProcoreId += 1;
          if (unmatchedSamples.length < 50) {
            unmatchedSamples.push({
              feedId: normalizeId(row.id),
              projectName: row.project_name,
              externalId: row.external_id,
              procoreId: row.procore_id,
              reason: 'no_project_with_matching_procore_id',
            });
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`row:${row.id} => ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        checked: candidates.length,
        matched,
        unmatched,
        unmatchedMissingProcoreId,
        unmatchedNoProjectByProcoreId,
        unmatchedSamples,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to verify Procore feed matches: ${message}` },
      { status: 500 }
    );
  }
}
