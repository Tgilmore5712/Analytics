import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import {
  consolidateDuplicateGanttV2Projects,
  consolidateDuplicateGanttV2Scopes,
  ensureGanttV2Schema,
  getGanttV2ProjectsWithScopes,
  syncGanttV2ProjectsFromCanonicalProjects,
} from '@/lib/ganttV2Db';
import { getErrorMessage, shouldFallbackToEmptyRead, withDatabaseRetry } from '@/lib/dbResilience';

export const dynamic = 'force-dynamic';
const GANTT_PROJECTS_MAINTENANCE_TTL_MS = 60_000;
let lastGanttProjectsMaintenanceAt = 0;

export async function GET() {
  try {
    const cookieStore = await cookies();
    const procoreAccessToken = String(cookieStore.get('procore_access_token')?.value || '').trim() || null;
    const procoreCompanyId = String(cookieStore.get('procore_company_id')?.value || '').trim() || null;

    const projects = await withDatabaseRetry(async () => {
      await ensureGanttV2Schema();
      const now = Date.now();
      if (now - lastGanttProjectsMaintenanceAt > GANTT_PROJECTS_MAINTENANCE_TTL_MS) {
        await syncGanttV2ProjectsFromCanonicalProjects();
        await consolidateDuplicateGanttV2Projects();
        await consolidateDuplicateGanttV2Scopes();
        lastGanttProjectsMaintenanceAt = now;
      }
      return getGanttV2ProjectsWithScopes({
        procoreAccessToken,
        procoreCompanyId,
        includeEstimateHours: false,
      });
    });
    return NextResponse.json({ success: true, data: projects });
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json(
      { success: false, error: `Failed to load Gantt V2 projects: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await withDatabaseRetry(() => ensureGanttV2Schema());
    const body = await request.json();

    const projectName = (body?.projectName || '').toString().trim();
    const customer = (body?.customer || '').toString().trim() || null;
    const projectNumber = (body?.projectNumber || '').toString().trim() || null;
    const status = (body?.status || '').toString().trim() || null;

    if (!projectName) {
      return NextResponse.json(
        { success: false, error: 'projectName is required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO gantt_v2_projects (id, project_name, customer, project_number, status, source)
        VALUES ($1, $2, $3, $4, $5, $6);
      `,
      id,
      projectName,
      customer,
      projectNumber,
      status,
      'app'
    );

    return NextResponse.json({ success: true, data: { id, projectName, customer, projectNumber, status, source: 'app' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to create Gantt V2 project: ${String(error)}` },
      { status: 500 }
    );
  }
}
