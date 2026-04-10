import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const targetWhere = {
    projectArchived: { not: true },
    OR: [
      { sales: 0 },
      { sales: null },
    ],
  };

  const activeZeroSales = await prisma.project.findMany({
    where: {
      ...targetWhere,
    },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      status: true,
      projectArchived: true,
      updatedAt: true,
    },
    orderBy: [{ projectName: 'asc' }],
  });

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    activeZeroSalesCount: activeZeroSales.length,
    sample: activeZeroSales.slice(0, 30),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const backupTable = `project_zero_sales_backup_${stamp}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE ${backupTable} AS TABLE \"Project\" WITH DATA`);

  const updated = await prisma.project.updateMany({
    where: {
      ...targetWhere,
    },
    data: {
      projectArchived: true,
    },
  });

  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-zero-sales-archive-${stamp}.json`);

  writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        backupTable,
        affectedCount: updated.count,
        affectedIds: activeZeroSales.map((r) => r.id),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        success: true,
        archivedCount: updated.count,
        backupTable,
        snapshotPath,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
