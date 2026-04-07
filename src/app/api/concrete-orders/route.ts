import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import {
  buildConcreteConfirmationByJobDate,
  type ConcreteConfirmationTotals,
  type ProjectScopeTaskRow,
} from '@/lib/concreteTaskSummary';

export const dynamic = 'force-dynamic';

let tableEnsured = false;

async function ensureConcreteOrdersTable() {
  if (tableEnsured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS concrete_orders (
      id TEXT PRIMARY KEY,
      job_key TEXT NOT NULL,
      project_name TEXT NOT NULL,
      concrete_company TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      total_yards DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS concrete_orders_date_time_idx
    ON concrete_orders (date, time)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS concrete_orders_job_key_idx
    ON concrete_orders (job_key)
  `);
  tableEnsured = true;
}

type ConcreteOrderRow = {
  id: string;
  job_key: string;
  project_name: string;
  concrete_company: string;
  date: string;
  time: string;
  total_yards: number;
  created_at: Date;
};

function toResponseShape(
  row: ConcreteOrderRow,
  confirmationByJobDate?: Map<string, ConcreteConfirmationTotals>
) {
  const confirmationKey = `${row.job_key}__${row.date}`;
  const totals = confirmationByJobDate?.get(confirmationKey);
  const concreteConfirmed =
    totals && totals.total > 0
      ? totals.confirmed === totals.total
      : null;

  return {
    id: row.id,
    jobKey: row.job_key,
    projectName: row.project_name,
    concreteCompany: row.concrete_company,
    date: row.date,
    time: row.time,
    totalYards: Number(row.total_yards || 0),
    concreteConfirmed,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const startDate = request.nextUrl.searchParams.get('startDate') || '';
    const endDate = request.nextUrl.searchParams.get('endDate') || '';
    const beforeTime = request.nextUrl.searchParams.get('beforeTime') || '';

    const rows = await prisma.$queryRaw<ConcreteOrderRow[]>`
      SELECT id, job_key, project_name, concrete_company, date, time, total_yards, created_at
      FROM concrete_orders
      ORDER BY date ASC, time ASC, created_at ASC
    `;

    const filtered = rows.filter((row) => {
      if (startDate && row.date < startDate) return false;
      if (endDate && row.date > endDate) return false;
      if (beforeTime && row.time >= beforeTime) return false;
      return true;
    });

    const relevantJobKeys = Array.from(new Set(filtered.map((row) => String(row.job_key || '').trim()).filter(Boolean)));
    let confirmationByJobDate = new Map<string, ConcreteConfirmationTotals>();

    if (relevantJobKeys.length > 0) {
      try {
        const scopeRows = await prisma.projectScope.findMany({
          where: { jobKey: { in: relevantJobKeys } },
          select: {
            jobKey: true,
            tasks: true,
          },
        }) as unknown as ProjectScopeTaskRow[];

        confirmationByJobDate = buildConcreteConfirmationByJobDate(scopeRows);
      } catch (error) {
        console.warn('Failed to enrich concrete order confirmation status:', error);
      }
    }

    return NextResponse.json({
      success: true,
      data: filtered.map((row) => toResponseShape(row, confirmationByJobDate)),
      taskSummaries: Array.from(confirmationByJobDate.entries()).map(([key, totals]) => {
        const [jobKey, date] = key.split('__');
        return {
          jobKey,
          date,
          totalYards: Number(totals.totalYards || 0),
          knownConfirmations: totals.total,
          confirmedCount: totals.confirmed,
        };
      }),
    });
  } catch (error) {
    console.error('Failed to fetch concrete orders:', error);
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json(
      { success: false, error: `Failed to fetch concrete orders: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const body = await request.json();
    const jobKey = (body?.jobKey || '').trim();
    const projectName = (body?.projectName || '').trim();
    const concreteCompany = (body?.concreteCompany || '').trim();
    const date = (body?.date || '').trim();
    const time = (body?.time || '').trim();
    const totalYards = Number(body?.totalYards || 0);

    if (!jobKey || !projectName || !concreteCompany || !date || !time || !Number.isFinite(totalYards) || totalYards <= 0) {
      return NextResponse.json(
        { success: false, error: 'jobKey, projectName, concreteCompany, date, time, and totalYards are required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO concrete_orders (id, job_key, project_name, concrete_company, date, time, total_yards)
      VALUES (${id}, ${jobKey}, ${projectName}, ${concreteCompany}, ${date}, ${time}, ${totalYards})
    `;

    return NextResponse.json({
      success: true,
      data: {
        id,
        jobKey,
        projectName,
        concreteCompany,
        date,
        time,
        totalYards,
      },
    });
  } catch (error) {
    console.error('Failed to save concrete order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save concrete order' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const body = await request.json();
    const id = (body?.id || '').trim();
    const concreteCompany = (body?.concreteCompany || '').trim();
    const date = (body?.date || '').trim();
    const time = (body?.time || '').trim();
    const totalYards = Number(body?.totalYards || 0);

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    if (!concreteCompany || !date || !time || !Number.isFinite(totalYards) || totalYards <= 0) {
      return NextResponse.json(
        { success: false, error: 'concreteCompany, date, time, and totalYards are required' },
        { status: 400 }
      );
    }

    await prisma.$executeRaw`
      UPDATE concrete_orders
      SET concrete_company = ${concreteCompany},
          date = ${date},
          time = ${time},
          total_yards = ${totalYards}
      WHERE id = ${id}
    `;

    const rows = await prisma.$queryRaw<ConcreteOrderRow[]>`
      SELECT id, job_key, project_name, concrete_company, date, time, total_yards, created_at
      FROM concrete_orders
      WHERE id = ${id}
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: toResponseShape(rows[0]) });
  } catch (error) {
    console.error('Failed to update concrete order:', error);
    return NextResponse.json(
      { success: false, error: `Failed to update concrete order: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const body = await request.json();
    const id = (body?.id || '').trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.$executeRaw`
      DELETE FROM concrete_orders
      WHERE id = ${id}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete concrete order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete concrete order' },
      { status: 500 }
    );
  }
}
