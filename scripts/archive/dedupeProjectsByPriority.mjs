import { PrismaClient } from '@prisma/client';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function salesValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function customerSource(v) {
  return norm(v);
}

function sourcePreferredScore(row) {
  let score = 0;
  if (salesValue(row.sales) > 0) score += 1000;
  if (customerSource(row.customerSource) === 'procore_v1') score += 500;
  if (customerSource(row.customerSource) === 'procore_bid_board') score += 300;
  if (hasText(row.procoreId)) score += 100;
  if (hasText(row.bidBoardId)) score += 80;
  if (hasText(row.projectNumber)) score += 20;
  if (row.updatedAt instanceof Date) score += Math.floor(row.updatedAt.getTime() / 1000000000);
  return score;
}

function toObj(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return { ...v };
}

function loadCsvPriorityIndex(csvPath) {
  const raw = readFileSync(csvPath, 'utf8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  });

  const csvNameCustomer = new Set();
  const csvNameCustomerNumber = new Set();

  for (const r of records) {
    const name = norm(r.projectName);
    const customer = norm(r.customer);
    const number = norm(r.projectNumber);

    if (name || customer) {
      csvNameCustomer.add(`${name}|${customer}`);
    }
    if (name || customer || number) {
      csvNameCustomerNumber.add(`${name}|${customer}|${number}`);
    }
  }

  return {
    rowCount: records.length,
    csvNameCustomer,
    csvNameCustomerNumber,
  };
}

function chooseKeeper(items, csvIndex) {
  const v1SalesRows = items.filter(
    (r) => salesValue(r.sales) > 0 && customerSource(r.customerSource) === 'procore_v1'
  );
  if (v1SalesRows.length > 0) {
    const keeper = [...v1SalesRows].sort((a, b) => sourcePreferredScore(b) - sourcePreferredScore(a))[0];
    return { keeper, reason: 'sales_gt_0_and_customerSource_procore_v1' };
  }

  const bidBoardSalesRows = items.filter(
    (r) => salesValue(r.sales) > 0 && customerSource(r.customerSource) === 'procore_bid_board'
  );
  if (bidBoardSalesRows.length > 0) {
    const keeper = [...bidBoardSalesRows].sort((a, b) => sourcePreferredScore(b) - sourcePreferredScore(a))[0];
    return { keeper, reason: 'sales_gt_0_and_customerSource_procore_bid_board' };
  }

  const csvMatched = items.filter((r) => {
    const key3 = `${norm(r.projectName)}|${norm(r.customer)}|${norm(r.projectNumber)}`;
    const key2 = `${norm(r.projectName)}|${norm(r.customer)}`;
    return csvIndex.csvNameCustomerNumber.has(key3) || csvIndex.csvNameCustomer.has(key2);
  });

  if (csvMatched.length > 0) {
    const keeper = [...csvMatched].sort((a, b) => sourcePreferredScore(b) - sourcePreferredScore(a))[0];
    return { keeper, reason: 'fallback_bid_distro_preconstruction_csv' };
  }

  const keeper = [...items].sort((a, b) => sourcePreferredScore(b) - sourcePreferredScore(a))[0];
  return { keeper, reason: 'fallback_best_available' };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const csvPath = join(process.cwd(), 'Bid_Distro-Preconstruction.csv');
  const csvIndex = loadCsvPriorityIndex(csvPath);

  const rows = await prisma.project.findMany({
    where: { projectArchived: { not: true } },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      customerSource: true,
      status: true,
      procoreId: true,
      bidBoardId: true,
      projectArchived: true,
      customFields: true,
      updatedAt: true,
    },
  });

  // Group by business identity safe key.
  const groups = new Map();
  for (const r of rows) {
    const key = `${norm(r.projectName)}|${norm(r.customer)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const candidates = [];
  for (const [key, items] of groups.entries()) {
    if (items.length <= 1) continue;
    const pick = chooseKeeper(items, csvIndex);
    const archive = items.filter((r) => r.id !== pick.keeper.id);
    if (archive.length === 0) continue;
    candidates.push({
      key,
      reason: pick.reason,
      keeper: pick.keeper,
      archive,
      totalInGroup: items.length,
    });
  }

  const rowsToArchive = candidates.reduce((s, c) => s + c.archive.length, 0);
  const reasonCounts = candidates.reduce((acc, c) => {
    acc[c.reason] = (acc[c.reason] || 0) + 1;
    return acc;
  }, {});

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    csvRows: csvIndex.rowCount,
    activeScanned: rows.length,
    candidateGroupCount: candidates.length,
    rowsToArchive,
    reasonCounts,
    sample: candidates.slice(0, 30).map((c) => ({
      key: c.key,
      reason: c.reason,
      totalInGroup: c.totalInGroup,
      keeperId: c.keeper.id,
      keeperName: c.keeper.projectName,
      keeperNumber: c.keeper.projectNumber,
      keeperCustomer: c.keeper.customer,
      keeperSales: c.keeper.sales,
      keeperCustomerSource: c.keeper.customerSource,
      archiveIds: c.archive.map((a) => a.id),
      archiveCustomerSource: c.archive.map((a) => a.customerSource),
      archiveSales: c.archive.map((a) => a.sales),
    })),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const backupTable = `project_dedupe_priority_backup_${stamp}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE ${backupTable} AS TABLE \"Project\" WITH DATA`);

  const changedRows = [];

  await prisma.$transaction(async (tx) => {
    for (const c of candidates) {
      for (const row of c.archive) {
        const existing = await tx.project.findUnique({
          where: { id: row.id },
          select: { id: true, projectArchived: true, customFields: true },
        });
        if (!existing) continue;

        changedRows.push(existing);

        const cf = toObj(existing.customFields);
        cf.dedupePriority = {
          archivedAt: new Date().toISOString(),
          keeperProjectId: c.keeper.id,
          reason: c.reason,
          groupKey: c.key,
        };

        await tx.project.update({
          where: { id: row.id },
          data: {
            projectArchived: true,
            customFields: cf,
          },
        });
      }
    }
  });

  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-dedupe-priority-${stamp}.json`);

  writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        backupTable,
        changedCount: changedRows.length,
        changedRows,
        candidates: candidates.map((c) => ({
          key: c.key,
          reason: c.reason,
          keeperId: c.keeper.id,
          archiveIds: c.archive.map((a) => a.id),
        })),
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
        archivedCount: changedRows.length,
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
