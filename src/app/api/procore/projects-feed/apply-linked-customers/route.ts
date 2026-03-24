import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

const DEFAULT_INTERNAL_VENDOR_NAMES = [
  'paradise masonry, llc',
  'paradise concrete solutions',
  'mcdonnel consulting',
  'pmc procore direct costs',
];

const NON_MEANINGFUL_CUSTOMERS = new Set(['unknown', 'n/a', 'na', 'none', 'null', '-']);

function normalizeText(value: unknown): string {
  return (value ?? '').toString().trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isMeaningfulCustomer(value: unknown): value is string {
  const text = normalizeText(value);
  if (!text) return false;
  return !NON_MEANINGFUL_CUSTOMERS.has(text.toLowerCase());
}

function getInternalVendorSet(): Set<string> {
  const configured = (process.env.PROCORE_INTERNAL_VENDOR_NAMES || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

  return new Set([...DEFAULT_INTERNAL_VENDOR_NAMES, ...configured]);
}

type FeedRow = {
  id: unknown;
  company_id: string;
  external_id: string;
  procore_id: string | null;
  project_name: string;
  customer: string | null;
  customer_source: string | null;
  linked_project_id: string | null;
  match_confidence: string | null;
};

function normalizeId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

async function getExternalVendorCustomers(params: {
  companyId: string;
  projectId: string;
  internalVendorSet: Set<string>;
}) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
    `
      SELECT DISTINCT name
      FROM procore_project_vendors
      WHERE company_id = $1
        AND project_id = $2
        AND soft_deleted = FALSE
        AND name IS NOT NULL
      ORDER BY name ASC
    `,
    params.companyId,
    params.projectId
  );

  return rows
    .map((r) => normalizeText(r.name))
    .filter((name) => isMeaningfulCustomer(name) && !params.internalVendorSet.has(name.toLowerCase()));
}

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
        SELECT id, company_id, external_id, procore_id, project_name, customer, customer_source, linked_project_id, match_confidence
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

    const internalVendorSet = getInternalVendorSet();

    let eligible = 0;
    let applied = 0;
    let unchanged = 0;
    let skippedNoResolution = 0;
    let skippedInternalCustomer = 0;
    let skippedLowConfidence = 0;
    let skippedMissingProject = 0;
    let skippedAmbiguousVendor = 0;
    let skippedManualLock = 0;

    const sampleApplied: Array<{
      feedId: string;
      linkedProjectId: string;
      projectName: string;
      oldCustomer: string | null;
      newCustomer: string;
      source: string;
    }> = [];

    const quarantined: Array<{
      feedId: string;
      linkedProjectId: string | null;
      projectName: string;
      reason: string;
      candidates?: string[];
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
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      let resolvedCustomer: string | null = null;
      let resolvedSource: string | null = null;

      if (isMeaningfulCustomer(row.customer)) {
        resolvedCustomer = normalizeText(row.customer);
        resolvedSource = normalizeText(row.customer_source) || 'projects_feed';
      } else {
        const projectId = normalizeText(row.procore_id || row.external_id);
        if (projectId) {
          const vendorCustomers = await getExternalVendorCustomers({
            companyId: row.company_id,
            projectId,
            internalVendorSet,
          });

          if (vendorCustomers.length === 1) {
            resolvedCustomer = vendorCustomers[0];
            resolvedSource = 'project_vendors';
          } else if (vendorCustomers.length > 1) {
            skippedAmbiguousVendor += 1;
            if (quarantined.length < 50) {
              quarantined.push({
                feedId: normalizeId(row.id),
                linkedProjectId: row.linked_project_id,
                projectName: row.project_name,
                reason: 'ambiguous_vendor_customers',
                candidates: vendorCustomers.slice(0, 10),
                matchConfidence: row.match_confidence,
              });
            }
            continue;
          }
        }
      }

      if (!resolvedCustomer || !resolvedSource) {
        skippedNoResolution += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'no_meaningful_customer',
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      if (internalVendorSet.has(resolvedCustomer.toLowerCase())) {
        skippedInternalCustomer += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'internal_customer_name',
            candidates: [resolvedCustomer],
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

      const existing = await prisma.project.findUnique({
        where: { id: row.linked_project_id },
        select: { id: true, customer: true, customFields: true },
      });

      if (!existing) {
        skippedMissingProject += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: row.linked_project_id,
            projectName: row.project_name,
            reason: 'linked_project_not_found',
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      const oldCustomer = normalizeText(existing.customer);
      const existingCustomFields =
        existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
          ? (existing.customFields as Record<string, unknown>)
          : {};

      if (existingCustomFields.customerManualLock === true) {
        skippedManualLock += 1;
        if (quarantined.length < 50) {
          quarantined.push({
            feedId: normalizeId(row.id),
            linkedProjectId: existing.id,
            projectName: row.project_name,
            reason: 'manual_customer_lock',
            candidates: [resolvedCustomer],
            matchConfidence: row.match_confidence,
          });
        }
        continue;
      }

      if (oldCustomer === resolvedCustomer) {
        unchanged += 1;
        continue;
      }

      if (!dryRun) {
        await prisma.project.update({
          where: { id: existing.id },
          data: {
            customer: resolvedCustomer,
            customFields: {
              ...existingCustomFields,
              customerSource: resolvedSource,
              customerSyncedAt: new Date().toISOString(),
              customerFeedProjectId: row.procore_id || row.external_id,
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
          oldCustomer: existing.customer,
          newCustomer: resolvedCustomer,
          source: resolvedSource,
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
        skippedInternalCustomer,
        skippedLowConfidence,
        skippedMissingProject,
        skippedAmbiguousVendor,
        skippedManualLock,
        sampleApplied,
        quarantined,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to apply linked customers: ${message}` },
      { status: 500 }
    );
  }
}
