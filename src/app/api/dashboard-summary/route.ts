import { prisma } from '@/lib/prisma';
import { getCanonicalProjectIdentity } from '@/lib/projectCanonical';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeProjectIdentity = (searchParams.get('includeProjectIdentity') || '').trim().toLowerCase() === 'true';

    const summary = await prisma.dashboardSummary.findUnique({
      where: { id: 'summary' },
    });

    let projectIdentityCoverage: {
      totalProjects: number;
      withProcoreId: number;
      withBidBoardId: number;
      withCustomerSource: number;
      withStatusSource: number;
    } | null = null;

    if (includeProjectIdentity) {
      const projects = await prisma.project.findMany({
        select: {
          id: true,
          procoreId: true,
          bidBoardId: true,
          customerSource: true,
          statusSource: true,
          customFields: true,
        },
      });

      let withProcoreId = 0;
      let withBidBoardId = 0;
      let withCustomerSource = 0;
      let withStatusSource = 0;

      for (const project of projects) {
        const identity = getCanonicalProjectIdentity(project);
        if (identity.procoreId) withProcoreId += 1;
        if (identity.bidBoardId) withBidBoardId += 1;
        if (identity.customerSource) withCustomerSource += 1;
        if (identity.statusSource) withStatusSource += 1;
      }

      projectIdentityCoverage = {
        totalProjects: projects.length,
        withProcoreId,
        withBidBoardId,
        withCustomerSource,
        withStatusSource,
      };
    }

    if (!summary) {
      return NextResponse.json({
        success: true,
        data: null,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        totalSales: summary.totalSales,
        totalCost: summary.totalCost,
        totalHours: summary.totalHours,
        statusGroups: summary.statusGroups,
        contractors: summary.contractors,
        pmcGroupHours: summary.pmcGroupHours,
        laborBreakdown: summary.laborBreakdown,
        lastUpdated: summary.lastUpdated,
        ...(projectIdentityCoverage ? { projectIdentityCoverage } : {}),
      },
    });
  } catch (error) {
    console.error('Failed to fetch dashboard summary:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch dashboard summary' },
      { status: 500 }
    );
  }
}
