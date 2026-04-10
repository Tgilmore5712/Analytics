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

  const archivedProjects = await prisma.project.findMany({
    where: { projectArchived: true },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const archivedIds = archivedProjects.map((p) => p.id);
  if (archivedIds.length === 0) {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', archivedProjects: 0, deletableProjects: 0, blockedProjects: 0 }, null, 2));
    return;
  }

  const [
    scopeRows,
    scheduleRows,
    activeScheduleRows,
    scopeTrackingRows,
    productivityRows,
    timecardRows,
    timecardTypeRows,
    commitmentRows,
    changeOrderRows,
    lineItemRows,
    purchaseOrderRows,
    purchaseOrderDetailRows,
  ] = await Promise.all([
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

  const refMap = new Map();
  for (const id of archivedIds) {
    refMap.set(id, {
      projectScopes: 0,
      schedules: 0,
      activeSchedules: 0,
      scopeTrackings: 0,
      productivityLogs: 0,
      timecardEntries: 0,
      timecardTimeTypes: 0,
      commitmentContracts: 0,
      commitmentChangeOrders: 0,
      commitmentChangeOrderLineItems: 0,
      purchaseOrderContracts: 0,
      purchaseOrderLineItemContractDetails: 0,
    });
  }

  const add = (rows, field) => {
    for (const row of rows) {
      const id = row.projectId;
      if (!id || !refMap.has(id)) continue;
      refMap.get(id)[field] += 1;
    }
  };

  add(scopeRows, 'projectScopes');
  add(scheduleRows, 'schedules');
  add(activeScheduleRows, 'activeSchedules');
  add(scopeTrackingRows, 'scopeTrackings');
  add(productivityRows, 'productivityLogs');
  add(timecardRows, 'timecardEntries');
  add(timecardTypeRows, 'timecardTimeTypes');
  add(commitmentRows, 'commitmentContracts');
  add(changeOrderRows, 'commitmentChangeOrders');
  add(lineItemRows, 'commitmentChangeOrderLineItems');
  add(purchaseOrderRows, 'purchaseOrderContracts');
  add(purchaseOrderDetailRows, 'purchaseOrderLineItemContractDetails');

  const deletable = [];
  const blocked = [];
  for (const project of archivedProjects) {
    const refs = refMap.get(project.id);
    const totalRefs = Object.values(refs).reduce((sum, value) => sum + value, 0);
    const row = { ...project, refs, totalRefs };
    if (totalRefs === 0) deletable.push(row);
    else blocked.push(row);
  }

  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    archivedProjects: archivedProjects.length,
    deletableProjects: deletable.length,
    blockedProjects: blocked.length,
    blockedRefTotals: {
      projectScopes: scopeRows.length,
      schedules: scheduleRows.length,
      activeSchedules: activeScheduleRows.length,
      scopeTrackings: scopeTrackingRows.length,
      productivityLogs: productivityRows.length,
      timecardEntries: timecardRows.length,
      timecardTimeTypes: timecardTypeRows.length,
      commitmentContracts: commitmentRows.length,
      commitmentChangeOrders: changeOrderRows.length,
      commitmentChangeOrderLineItems: lineItemRows.length,
      purchaseOrderContracts: purchaseOrderRows.length,
      purchaseOrderLineItemContractDetails: purchaseOrderDetailRows.length,
    },
    sampleDeletable: deletable.slice(0, 25),
    sampleBlocked: blocked.slice(0, 25),
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!apply || deletable.length === 0) return;

  const stamp = nowStamp();
  const backupTable = `project_hard_delete_backup_${stamp}`;
  await prisma.$executeRawUnsafe(`CREATE TABLE ${backupTable} AS TABLE \"Project\" WITH DATA`);

  const deletedRows = await prisma.project.findMany({
    where: { id: { in: deletable.map((p) => p.id) } },
  });

  const result = await prisma.project.deleteMany({
    where: { id: { in: deletable.map((p) => p.id) } },
  });

  const snapshotDir = join(process.cwd(), 'snapshots', 'dedupe');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = join(snapshotDir, `project-hard-delete-${stamp}.json`);

  writeFileSync(snapshotPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    backupTable,
    deletedCount: result.count,
    deletedRows,
    blockedCount: blocked.length,
    blockedIds: blocked.map((p) => p.id),
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    success: true,
    deletedCount: result.count,
    blockedCount: blocked.length,
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
