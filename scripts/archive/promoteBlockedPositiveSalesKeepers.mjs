import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function getBlockedArchivedPositiveSales() {
  const archivedProjects = await prisma.project.findMany({
    where: { projectArchived: true, sales: { gt: 0 } },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      status: true,
      customerSource: true,
      procoreId: true,
      bidBoardId: true,
      updatedAt: true,
      customFields: true,
    },
  });

  const archivedIds = archivedProjects.map((p) => p.id);
  const allRefRows = await Promise.all([
    prisma.projectScope.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.schedule.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.activeSchedule.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.scopeTracking.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.productivityLog.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.timecardEntry.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.timecardTimeType.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.commitmentContract.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.commitmentChangeOrder.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.commitmentChangeOrderLineItem.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.purchaseOrderContract.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
    prisma.purchaseOrderLineItemContractDetail.findMany({ where: { projectId: { in: archivedIds } }, select: { projectId: true } }),
  ]);

  const blockedIds = new Set();
  for (const rows of allRefRows) {
    for (const row of rows) {
      if (row.projectId) blockedIds.add(row.projectId);
    }
  }

  return archivedProjects.filter((p) => blockedIds.has(p.id));
}

async function moveRefs(tx, oldId, newId) {
  await tx.projectScope.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.schedule.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.activeSchedule.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.scopeTracking.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.productivityLog.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.timecardEntry.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.timecardTimeType.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.commitmentContract.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.commitmentChangeOrder.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.commitmentChangeOrderLineItem.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.purchaseOrderContract.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
  await tx.purchaseOrderLineItemContractDetail.updateMany({ where: { projectId: oldId }, data: { projectId: newId } });
}

async function main() {
  const apply = process.argv.includes('--apply');

  const keepers = await getBlockedArchivedPositiveSales();
  const allProjects = await prisma.project.findMany({
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      status: true,
      customerSource: true,
      procoreId: true,
      bidBoardId: true,
      projectArchived: true,
      updatedAt: true,
      customFields: true,
    },
  });

  const groups = new Map();
  for (const project of allProjects) {
    const key = `${norm(project.projectName)}|${norm(project.customer)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  }

  const plan = [];
  for (const keeper of keepers) {
    const key = `${norm(keeper.projectName)}|${norm(keeper.customer)}`;
    const others = (groups.get(key) || []).filter((p) => p.id !== keeper.id);
    const activeDuplicates = others.filter((p) => !p.projectArchived);
    if (activeDuplicates.length === 0) continue;
    plan.push({ key, keeper, activeDuplicates });
  }

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    keepersToPromote: plan.length,
    duplicateRowsToDelete: plan.reduce((sum, p) => sum + p.activeDuplicates.length, 0),
    sample: plan.slice(0, 20).map((item) => ({
      key: item.key,
      keeper: {
        id: item.keeper.id,
        projectName: item.keeper.projectName,
        customer: item.keeper.customer,
        sales: item.keeper.sales,
        customerSource: item.keeper.customerSource,
        projectArchived: true,
      },
      activeDuplicates: item.activeDuplicates.map((dup) => ({
        id: dup.id,
        projectName: dup.projectName,
        customer: dup.customer,
        sales: dup.sales,
        customerSource: dup.customerSource,
        projectArchived: dup.projectArchived,
      })),
    })),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) return;

  const stamp = nowStamp();
  const backupTable = `project_promote_keepers_backup_${stamp}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE ${backupTable} AS TABLE \"Project\" WITH DATA`);

  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-promote-keepers-${stamp}.json`);

  const operations = [];

  for (const item of plan) {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: item.keeper.id },
        data: { projectArchived: false },
      });

      for (const dup of item.activeDuplicates) {
        await moveRefs(tx, dup.id, item.keeper.id);

        operations.push({
          keeperId: item.keeper.id,
          duplicateId: dup.id,
        });

        await tx.project.delete({
          where: { id: dup.id },
        });
      }
    }, {
      maxWait: 30000,
      timeout: 120000,
    });
  }

  writeFileSync(snapshotPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    backupTable,
    operations,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    success: true,
    promotedKeepers: plan.length,
    deletedDuplicates: operations.length,
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
