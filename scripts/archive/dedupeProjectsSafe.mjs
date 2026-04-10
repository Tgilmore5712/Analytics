import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function toCustomFieldsObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function dedupeKey(project) {
  if (hasText(project.procoreId)) return `procore:${project.procoreId.trim()}`;
  if (hasText(project.bidBoardId)) return `bid:${project.bidBoardId.trim()}`;

  const name = norm(project.projectName);
  const number = norm(project.projectNumber);
  const customer = norm(project.customer);
  return `identity:${name}|${number}|${customer}`;
}

function keeperScore(project) {
  let score = 0;
  if (hasText(project.procoreId)) score += 100;
  if (hasText(project.bidBoardId)) score += 50;
  if (hasText(project.projectNumber)) score += 10;
  if (hasText(project.customer)) score += 5;
  if (project.updatedAt instanceof Date) {
    score += Math.floor(project.updatedAt.getTime() / 1000000000);
  }
  return score;
}

function pickKeeper(group) {
  const sorted = [...group].sort((a, b) => keeperScore(b) - keeperScore(a));
  return sorted[0];
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const includeArchived = args.includes('--include-archived');

  const where = includeArchived ? {} : { projectArchived: { not: true } };

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      procoreId: true,
      bidBoardId: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      projectArchived: true,
      customFields: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  const groups = new Map();
  for (const p of projects) {
    const key = dedupeKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const duplicateGroups = [...groups.entries()]
    .map(([key, items]) => ({ key, items }))
    .filter((entry) => entry.items.length > 1);

  let totalToArchive = 0;
  const actions = [];

  for (const group of duplicateGroups) {
    const keeper = pickKeeper(group.items);
    const archive = group.items.filter((p) => p.id !== keeper.id);
    totalToArchive += archive.length;
    actions.push({
      key: group.key,
      keeperId: keeper.id,
      keeperName: keeper.projectName,
      keeperNumber: keeper.projectNumber,
      keeperCustomer: keeper.customer,
      archiveIds: archive.map((p) => p.id),
      archiveNames: archive.map((p) => p.projectName),
    });
  }

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    scannedProjects: projects.length,
    duplicateGroupCount: duplicateGroups.length,
    projectsToArchive: totalToArchive,
    sampleGroups: actions.slice(0, 15),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const backupTable = `project_dedupe_backup_${stamp}`;
  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-dedupe-${stamp}.json`);

  // Full table snapshot for manual restore confidence.
  await prisma.$executeRawUnsafe(`CREATE TABLE ${backupTable} AS TABLE \"Project\" WITH DATA`);

  const changedRows = [];

  await prisma.$transaction(async (tx) => {
    for (const action of actions) {
      for (const duplicateId of action.archiveIds) {
        const existing = await tx.project.findUnique({
          where: { id: duplicateId },
          select: { id: true, projectArchived: true, customFields: true },
        });

        if (!existing) continue;

        changedRows.push(existing);

        const cf = toCustomFieldsObject(existing.customFields);
        cf.dedupe = {
          ...(cf.dedupe && typeof cf.dedupe === 'object' ? cf.dedupe : {}),
          archivedAt: new Date().toISOString(),
          keeperProjectId: action.keeperId,
          reason: 'safe_soft_dedupe',
          groupKey: action.key,
        };

        await tx.project.update({
          where: { id: duplicateId },
          data: {
            projectArchived: true,
            customFields: cf,
          },
        });
      }
    }
  });

  const snapshot = {
    executedAt: new Date().toISOString(),
    backupTable,
    changedCount: changedRows.length,
    changedRows,
    actions,
  };

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log(JSON.stringify({
    success: true,
    backupTable,
    snapshotPath,
    archivedCount: changedRows.length,
    rollbackHint: `Use snapshot ${snapshotPath} to restore projectArchived/customFields, or query backup table ${backupTable}.`,
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
