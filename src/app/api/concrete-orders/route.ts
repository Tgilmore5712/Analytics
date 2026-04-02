import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';

export const dynamic = 'force-dynamic';

async function ensureConcreteOrdersTable() {
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

type ProjectScopeTaskRow = {
  jobKey: string;
  tasks: unknown;
};

type ConcreteConfirmationTotals = {
  total: number;
  confirmed: number;
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getTaskConcreteSnapshot(task: unknown): { date: string; confirmed: boolean } | null {
  if (!task) return null;

  if (typeof task === 'string') {
    const trimmed = task.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!match) return null;

    const parts = String(match[1] || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);

    const date = parts.find((part) => DATE_KEY_REGEX.test(part));
    if (!date) return null;

    let yardsValue: number | null = null;
    for (const part of parts) {
      if (DATE_KEY_REGEX.test(part)) continue;
      if (/\d+\s*d$/i.test(part)) continue;
      const numericMatch = part.match(/(\d+(?:\.\d+)?)/);
      if (!numericMatch) continue;
      const parsed = Number.parseFloat(numericMatch[1]);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      yardsValue = parsed;
      break;
    }

    if (!Number.isFinite(yardsValue || 0) || (yardsValue || 0) <= 0) return null;
    return { date, confirmed: false };
  }

  if (typeof task !== 'object' || Array.isArray(task)) return null;

  const row = task as Record<string, unknown>;
  const date = String(row.startDate || '').trim();
  if (!DATE_KEY_REGEX.test(date)) return null;

  const yards = Number(row.yards);
  if (!Number.isFinite(yards) || yards <= 0) return null;

  return {
    date,
    confirmed: row.concreteConfirmed === true,
  };
}

function buildConcreteConfirmationByJobDate(rows: ProjectScopeTaskRow[]): Map<string, ConcreteConfirmationTotals> {
  const totals = new Map<string, ConcreteConfirmationTotals>();

  for (const row of rows) {
    const jobKey = String(row.jobKey || '').trim();
    if (!jobKey) continue;
    if (!Array.isArray(row.tasks)) continue;

    for (const task of row.tasks) {
      const snapshot = getTaskConcreteSnapshot(task);
      if (!snapshot) continue;

      const key = `${jobKey}__${snapshot.date}`;
      const current = totals.get(key) || { total: 0, confirmed: 0 };
      current.total += 1;
      if (snapshot.confirmed) current.confirmed += 1;
      totals.set(key, current);
    }
  }

  return totals;
}

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
