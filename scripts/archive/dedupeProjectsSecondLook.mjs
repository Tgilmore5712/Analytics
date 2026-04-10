import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

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

function scoreProject(p) {
  let score = 0;
  if (hasText(p.procoreId)) score += 100;
  if (hasText(p.bidBoardId)) score += 80;
  if (hasText(p.projectNumber)) score += 20;
  if (p.updatedAt instanceof Date) score += Math.floor(p.updatedAt.getTime() / 1000000000);
  return score;
}

function toObj(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return { ...v };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  const rows = await prisma.project.findMany({
    where: { projectArchived: { not: true } },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      status: true,
      procoreId: true,
      bidBoardId: true,
      projectArchived: true,
      customFields: true,
      updatedAt: true,
    },
  });

  // Strict second look: same name + same customer only.
  const groups = new Map();
  for (const r of rows) {
    const key = `${norm(r.projectName)}|${norm(r.customer)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const candidates = [];
  for (const [key, items] of groups.entries()) {
    if (items.length <= 1) continue;

    // Archive only the bid-board-only duplicate when a Procore-linked canonical row exists.
    // This avoids touching unrelated same-name records from different pipelines.
    const procoreRows = items.filter((p) => hasText(p.procoreId));
    const bidBoardOnlyRows = items.filter((p) => !hasText(p.procoreId) && hasText(p.bidBoardId));
    if (procoreRows.length === 0 || bidBoardOnlyRows.length === 0) continue;

    const keeper = [...procoreRows].sort((a, b) => scoreProject(b) - scoreProject(a))[0];

    candidates.push({
      key,
      keeper,
      archive: bidBoardOnlyRows,
      totalInGroup: items.length,
    });
  }

  const archiveCount = candidates.reduce((sum, c) => sum + c.archive.length, 0);

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    activeScanned: rows.length,
    candidateGroupCount: candidates.length,
    rowsToArchive: archiveCount,
    sample: candidates.slice(0, 25).map((c) => ({
      key: c.key,
      totalInGroup: c.totalInGroup,
      keeperId: c.keeper.id,
      keeperName: c.keeper.projectName,
      keeperNumber: c.keeper.projectNumber,
      keeperCustomer: c.keeper.customer,
      archiveIds: c.archive.map((a) => a.id),
      archiveNames: c.archive.map((a) => a.projectName),
      archiveNumbers: c.archive.map((a) => a.projectNumber),
    })),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const backupTable = `project_dedupe_second_backup_${stamp}`;
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
        cf.dedupeSecondLook = {
          archivedAt: new Date().toISOString(),
          keeperProjectId: c.keeper.id,
          reason: 'same_name_customer_bidboard_only_with_procore_keeper',
          key: c.key,
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
  const snapshotPath = join(snapshotDir, `project-dedupe-second-${stamp}.json`);

  writeFileSync(snapshotPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    backupTable,
    changedCount: changedRows.length,
    changedRows,
    candidates: candidates.map((c) => ({
      key: c.key,
      keeperId: c.keeper.id,
      archiveIds: c.archive.map((a) => a.id),
    })),
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    success: true,
    archivedCount: changedRows.length,
    backupTable,
    snapshotPath,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
