import { procoreConfig } from '@/lib/procore';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type UnknownRecord = Record<string, unknown>;

type TotalHoursRow = {
  totalquantity: number | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }

  return '';
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  return code === 'P2002' || code === '23505';
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getBidBoardStatusFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return '';

  return firstText(
    payload.bidBoardStatus,
    payload.bid_board_status,
    payload.bidStatus,
    payload.bid_status,
    isRecord(payload.bid_status) ? payload.bid_status.name : ''
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const projectIdentifier = firstText(body.projectId, body.procoreProjectId, body.externalId);
    const companyId = firstText(body.companyId, procoreConfig.companyId);

    if (!projectIdentifier) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: projectId' },
        { status: 400 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in the request.' },
        { status: 400 }
      );
    }

    const stagingProject = await prisma.procoreProjectStaging.findFirst({
      where: {
        source: 'procore_v1_projects',
        companyId,
        OR: [
          { externalId: projectIdentifier },
          { procoreProjectId: projectIdentifier },
        ],
      },
      orderBy: { syncedAt: 'desc' },
      select: {
        companyId: true,
        externalId: true,
        procoreProjectId: true,
        projectNumber: true,
        name: true,
        displayName: true,
        customer: true,
        status: true,
        payload: true,
      },
    });

    if (!stagingProject) {
      return NextResponse.json({
        success: false,
        error: 'No matching staging project found for the provided projectId.',
      }, { status: 404 });
    }

    const canonicalProjectName = firstText(stagingProject.name, stagingProject.displayName);
    const canonicalProjectNumber = firstText(
      stagingProject.procoreProjectId,
      stagingProject.projectNumber,
      stagingProject.externalId
    );
    const canonicalCustomer = firstText(stagingProject.customer);
    const canonicalStatus = firstText(
      getBidBoardStatusFromPayload(stagingProject.payload),
      stagingProject.status,
      'UNKNOWN'
    );

    if (!canonicalProjectName || !canonicalProjectNumber) {
      return NextResponse.json(
        {
          success: false,
          error: 'Staging project is missing canonical project identity fields.',
        },
        { status: 422 }
      );
    }

    const canonicalJobKey = `${canonicalCustomer}~${canonicalProjectNumber}~${canonicalProjectName}`;
    const legacyJobKey = `${canonicalCustomer}~${stagingProject.externalId}~${canonicalProjectName}`;

    let totalHours = 0;
    if (stagingProject.procoreProjectId) {
      const totalHoursRows = await prisma.$queryRawUnsafe<TotalHoursRow[]>(
        `
          SELECT SUM(COALESCE(quantity, 0))::float AS totalQuantity
          FROM budgetlineitems
          WHERE company_id = $1
            AND project_id = $2
            AND LOWER(COALESCE(uom, '')) IN ('hours', 'hr', 'hrs')
            AND LOWER(COALESCE(cost_code, '')) NOT IN ('project management.other', '01-300-10-20.o')
        `,
        stagingProject.companyId,
        stagingProject.procoreProjectId
      );

      totalHours = Number(totalHoursRows[0]?.totalquantity || 0);
    }

    const currentMonth = getCurrentMonthKey();

    const result = await prisma.$transaction(async (tx) => {
      const existingCanonical = await tx.schedule.findUnique({
        where: { jobKey: canonicalJobKey },
        select: {
          id: true,
          jobKey: true,
          totalHours: true,
        },
      });

      if (existingCanonical) {
        return {
          schedule: existingCanonical,
          isNew: false,
          migratedLegacyKey: false,
        };
      }

      if (legacyJobKey !== canonicalJobKey) {
        const existingLegacy = await tx.schedule.findUnique({
          where: { jobKey: legacyJobKey },
          select: {
            id: true,
            jobKey: true,
            customer: true,
            projectNumber: true,
            projectName: true,
            status: true,
            totalHours: true,
          },
        });

        if (existingLegacy) {
          const updatedLegacy = await tx.schedule.update({
            where: { id: existingLegacy.id },
            data: {
              jobKey: canonicalJobKey,
              customer: existingLegacy.customer || canonicalCustomer,
              projectNumber: existingLegacy.projectNumber || canonicalProjectNumber,
              projectName: existingLegacy.projectName || canonicalProjectName,
              status: existingLegacy.status || canonicalStatus,
              totalHours: existingLegacy.totalHours ?? totalHours,
            },
            select: {
              id: true,
              jobKey: true,
              totalHours: true,
            },
          });

          return {
            schedule: updatedLegacy,
            isNew: false,
            migratedLegacyKey: true,
          };
        }
      }

      const createdSchedule = await tx.schedule.create({
        data: {
          jobKey: canonicalJobKey,
          customer: canonicalCustomer,
          projectNumber: canonicalProjectNumber,
          projectName: canonicalProjectName,
          totalHours,
          status: canonicalStatus,
        },
        select: {
          id: true,
          jobKey: true,
          totalHours: true,
        },
      });

      if (totalHours > 0) {
        await tx.scheduleAllocation.create({
          data: {
            scheduleId: createdSchedule.id,
            period: currentMonth,
            hours: 0,
            percent: 0,
            periodType: 'month',
          },
        });
      }

      return {
        schedule: createdSchedule,
        isNew: true,
        migratedLegacyKey: false,
      };
    });

    return NextResponse.json({
      success: true,
      message: result.isNew
        ? 'Schedule created successfully'
        : result.migratedLegacyKey
          ? 'Existing schedule normalized to canonical job key'
          : 'Schedule already exists',
      data: {
        jobKey: result.schedule.jobKey,
        canonicalJobKey,
        scheduleId: result.schedule.id,
        isNew: result.isNew,
        migratedLegacyKey: result.migratedLegacyKey,
        totalHours: result.schedule.totalHours ?? totalHours,
        resolvedProjectId: stagingProject.procoreProjectId || stagingProject.externalId,
        projectName: canonicalProjectName,
        customer: canonicalCustomer,
        status: canonicalStatus,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: 'A schedule was created concurrently. Refresh and try again.',
        },
        { status: 409 }
      );
    }

    console.error('Failed to auto-create schedule from staging:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: `Failed to auto-create schedule: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
}
