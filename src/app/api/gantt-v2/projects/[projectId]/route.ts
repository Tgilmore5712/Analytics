import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

type RouteParams = {
  params: Promise<{ projectId: string }>;
};

export async function DELETE(_: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;

    // Get project info to construct jobKey for ActiveSchedule cleanup
    const project = await prisma.$queryRawUnsafe<Array<{
      customer: string | null;
      project_number: string | null;
      project_name: string;
    }>>(
      `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
      projectId
    );

    if (!project || project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const { customer, project_number, project_name } = project[0];
    const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;

    // Delete all ActiveSchedule entries for this project
    await prisma.activeSchedule.deleteMany({ where: { jobKey } });

    // Delete all ProjectScope metadata rows for this project
    await prisma.projectScope.deleteMany({ where: { jobKey } });

    // Delete all gantt scopes (cascade would handle this but be explicit)
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_scopes WHERE project_id = $1`,
      projectId
    );

    // Delete the project
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_projects WHERE id = $1`,
      projectId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to delete project: ${String(error)}` },
      { status: 500 }
    );
  }
}
