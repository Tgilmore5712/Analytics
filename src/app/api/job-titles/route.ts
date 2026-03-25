import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

type JobTitleRow = { id: string; title: string };
type JobTitleDbRow = { id: string; title: string };

const defaultTitles = [
  'Field Worker',
  'Project Manager',
  'Superintendent',
  'Foreman',
  'Estimator',
  'Office Staff',
  'Executive',
];

function getStorePath() {
  return path.join(process.cwd(), 'public', 'job-titles.json');
}

function readLegacyTitlesFromFile(): JobTitleRow[] {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return defaultTitles
      .sort((a, b) => a.localeCompare(b))
      .map((title, index) => ({ id: `default-${index + 1}`, title }));
  }

  const raw = fs.readFileSync(storePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `row-${index + 1}`,
      title: (item.title || '').toString().trim(),
    }))
    .filter((item) => item.title.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function listTitles(): Promise<JobTitleRow[]> {
  const rows = await prisma.$queryRaw<JobTitleDbRow[]>`
    SELECT id, title
    FROM job_titles
    ORDER BY title ASC
  `;

  return rows.map((row) => ({ id: row.id, title: row.title }));
}

async function backfillTitlesIfEmpty(): Promise<void> {
  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM job_titles
  `;
  const count = Number(countRows[0]?.count || 0);
  if (count > 0) return;

  const seedRows = readLegacyTitlesFromFile();
  for (const row of seedRows) {
    await prisma.$executeRaw`
      INSERT INTO job_titles (id, title)
      VALUES (${row.id}, ${row.title})
      ON CONFLICT (id)
      DO UPDATE SET title = EXCLUDED.title
    `;
  }
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await backfillTitlesIfEmpty();
    const jobTitles = await listTitles();

    return NextResponse.json({
      success: true,
      data: jobTitles,
    });
  } catch (error) {
    console.error('Failed to fetch job titles:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch job titles' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await backfillTitlesIfEmpty();

    const body = await request.json();
    const title = (body?.title || '').toString().trim();

    if (!title) {
      return NextResponse.json(
        { success: false, error: 'title is required' },
        { status: 400 }
      );
    }

    const existingRows = await listTitles();
    const existing = existingRows.find((row) => row.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      return NextResponse.json({ success: true, data: existing });
    }

    const created = {
      id: crypto.randomUUID(),
      title,
    };

    await prisma.$executeRaw`
      INSERT INTO job_titles (id, title)
      VALUES (${created.id}, ${created.title})
    `;

    return NextResponse.json({
      success: true,
      data: created,
    });
  } catch (error) {
    console.error('Failed to create job title:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create job title' },
      { status: 500 }
    );
  }
}
