import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';

export const dynamic = 'force-dynamic';

type ConcreteYardsRow = {
  job_key: string;
  date: string;
  total_yards: number;
};

export async function GET(request: NextRequest) {
  try {
    const jobKey = String(request.nextUrl.searchParams.get('jobKey') || '').trim();

    const rows = jobKey
      ? await prisma.$queryRaw<ConcreteYardsRow[]>`
          SELECT job_key, date, SUM(total_yards) AS total_yards
          FROM concrete_orders
          WHERE job_key = ${jobKey}
          GROUP BY job_key, date
          ORDER BY date ASC
        `
      : await prisma.$queryRaw<ConcreteYardsRow[]>`
          SELECT job_key, date, SUM(total_yards) AS total_yards
          FROM concrete_orders
          GROUP BY job_key, date
          ORDER BY job_key ASC, date ASC
        `;

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        jobKey: row.job_key,
        date: row.date,
        totalYards: Number(row.total_yards || 0),
      })),
    });
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json(
      { success: false, error: `Failed to fetch concrete yard summaries: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}
