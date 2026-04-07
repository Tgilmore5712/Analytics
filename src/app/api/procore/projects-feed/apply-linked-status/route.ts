import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

const NON_MEANINGFUL_STATUS = new Set(['', 'unknown', 'n/a', 'na', 'none', 'null', '-']);

const STATUS_NORMALIZATION: Record<string, string> = {
  bidding: 'Bid Submitted',
  bid_submitted: 'Bid Submitted',
  invitation: 'Invitations',
  invitations: 'Invitations',
  to_do: 'To Do',
  todo: 'To Do',
  in_progress: 'In Progress',
  complete: 'Complete',
  completed: 'Complete',
  accepted: 'Accepted',
  estimating: 'Estimating',
  preconstruction: 'Estimating',
  pre_construction: 'Estimating',
  course_of_construction: 'In Progress',
  course_of_constructions: 'In Progress',
  post_construction: 'Complete',
  lost: 'Lost',
  delayed: 'Delayed',
};

const STATUS_PRIORITY: Record<string, number> = {
  accepted: 6,
  'in progress': 5,
  'course of construction': 4,
  'post-construction': 4,
  'bid submitted': 3,
  estimating: 2,
  complete: 1,
  lost: 0,
  invitations: -1,
  'to do': -1,
};

function normalizeText(value: unknown): string {
  return (value ?? '').toString().trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeStatus(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  const lower = text.toLowerCase();
  if (NON_MEANINGFUL_STATUS.has(lower)) return null;

  const key = lower.replace(/[\s-]+/g, '_');
  return STATUS_NORMALIZATION[key] || text;
}

function statusPriority(status: string | null | undefined): number {
  const normalized = normalizeText(status).toLowerCase();
  return STATUS_PRIORITY[normalized] ?? 0;
}

function normalizeId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

type FeedRow = {
  id: unknown;
  company_id: string;
  external_id: string;
  procore_id: string | null;
  project_name: string;
  status: string | null;
  linked_project_id: string | null;
  match_confidence: string | null;
};

export async function POST(request: Request) {
  try {
    await ensureProcoreProjectFeedTable();

    const body = await request.json().catch(() => ({}));
    const companyId = normalizeText(body?.companyId || '');
    const requestedLimit = Number(body?.limit || 500);
    const limit = Math.min(5000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 500));
    const requestedOffset = Number(body?.offset || 0);
    const offset = Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0);
    const dryRun = body?.dryRun !== false;
    const includeLowConfidence = body?.includeLowConfidence === true;
    const allowStatusDowngrade = body?.allowStatusDowngrade === true;
    const writeProjectStatus = body?.writeProjectStatus === true;

    const conditions: string[] = ['linked_project_id IS NOT NULL', 'soft_deleted = FALSE'];
    const params: unknown[] = [];
    let p = 1;

    if (companyId) {
      conditions.push(`company_id = $${p++}`);
      params.push(companyId);
    }

    if (!includeLowConfidence) {
      conditions.push(`match_confidence IN ('high', 'medium')`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const rows = await prisma.$queryRawUnsafe<FeedRow[]>(
      `
        SELECT id, company_id, external_id, procore_id, project_name, status, linked_project_id, match_confidence
        FROM procore_project_feed
        ${whereClause}
        ORDER BY synced_at DESC, id DESC
        LIMIT $${p++}
        OFFSET $${p++}
      `,
      ...params,
      limit,
      offset
    );

    let eligible = 0;
    let applied = 0;
    let unchanged = 0;
    let skippedNoResolution = 0;
    let skippedLowConfidence = 0;
    let skippedMissingProject = 0;
    let skippedDowngrade = 0;
    let skippedPolicy = 0;

    const sampleApplied: Array<{
      feedId: string;
      linkedProjectId: string;
      projectName: string;
      oldStatus: string | null;
      newStatus: string;
      source: string;
    }> = [];

    const quarantined: Array<{
      feedId: string;
      linkedProjectId: string | null;
      projectName: string;
      reason: string;
      rawStatus?: string | null;
      matchConfidence: string | null;
    }> = [];

    for (const row of rows) {
      const confidence = normalizeLower(row.match_confidence);
      if (!includeLowConfidence && confidence !== 'high' && confidence !== 'medium') {
        skippedLowConfidence += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'low_confidence_match',
            rawStatus: row.status,
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      const resolvedStatus = normalizeStatus(row.status);
      if (!resolvedStatus) {
        skippedNoResolution += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'no_meaningful_status',
            rawStatus: row.status,
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      if (!row.linked_project_id) {
        skippedMissingProject += 1;
        continue;
      }

      eligible += 1;

      // Policy: project.status is owned by canonical Procore endpoint sync.
      // This route only writes status when explicitly requested.
      if (!writeProjectStatus) {
        skippedPolicy += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'status_write_disabled',
            rawStatus: row.status,
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      const existing = await prisma.project.findUnique({
        where: { id: row.linked_project_id },
        select: { id: true, status: true, customFields: true },
      });

      if (!existing) {
        skippedMissingProject += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'linked_project_not_found',
            rawStatus: row.status,
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      const oldStatus = normalizeText(existing.status);
      const oldPriority = statusPriority(oldStatus);
      const newPriority = statusPriority(resolvedStatus);

      if (!allowStatusDowngrade && oldStatus && newPriority < oldPriority) {
        skippedDowngrade += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'status_downgrade_blocked',
            rawStatus: row.status,
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      if (oldStatus === resolvedStatus) {
        unchanged += 1;
        continue;
      }

      if (!dryRun) {
        const existingCustomFields =
          existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
            ? (existing.customFields as Record<string, unknown>)
            : {};

        await prisma.project.update({
          where: { id: existing.id },
          data: {
            status: resolvedStatus,
            customFields: {
              ...existingCustomFields,
              statusSource: 'projects_feed',
              statusSyncedAt: new Date().toISOString(),
              statusFeedProjectId: row.procore_id || row.external_id,
              statusRaw: row.status,
            },
          },
        });
      }

      applied += 1;
      if (sampleApplied.length < 50) {
        sampleApplied.push({
          feedId: normalizeId(row.id),
          linkedProjectId: existing.id,
          projectName: row.project_name,
          oldStatus: existing.status,
          newStatus: resolvedStatus,
          source: 'projects_feed',
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        dryRun,
        limit,
        offset,
        rowsScanned: rows.length,
        eligible,
        applied,
        unchanged,
        skippedNoResolution,
        skippedLowConfidence,
        skippedMissingProject,
        skippedDowngrade,
        skippedPolicy,
        writeProjectStatus,
        allowStatusDowngrade,
        sampleApplied,
        quarantined,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to apply linked status: ${message}` },
      { status: 500 }
    );
  }
}
