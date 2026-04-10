import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const archivedProjects = await prisma.project.findMany({
    where: { projectArchived: true },
    select: {
      id: true,
      projectName: true,
      projectNumber: true,
      customer: true,
      sales: true,
      status: true,
    },
    orderBy: [{ projectName: 'asc' }, { customer: 'asc' }],
  });

  const archivedIds = archivedProjects.map((p) => p.id);

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

  const blockedIds = new Set();
  const add = (rows) => {
    for (const row of rows) {
      if (row.projectId) blockedIds.add(row.projectId);
    }
  };

  add(scopeRows);
  add(scheduleRows);
  add(activeScheduleRows);
  add(scopeTrackingRows);
  add(productivityRows);
  add(timecardRows);
  add(timecardTypeRows);
  add(commitmentRows);
  add(changeOrderRows);
  add(lineItemRows);
  add(purchaseOrderRows);
  add(purchaseOrderDetailRows);

  const blocked = archivedProjects.filter((p) => blockedIds.has(p.id));
  const salesPositive = blocked.filter((p) => typeof p.sales === 'number' && p.sales > 0);
  const salesZero = blocked.filter((p) => p.sales === 0);
  const salesNull = blocked.filter((p) => p.sales == null);

  console.log(JSON.stringify({
    blockedCount: blocked.length,
    salesPositiveCount: salesPositive.length,
    salesZeroCount: salesZero.length,
    salesNullCount: salesNull.length,
    nonPositive: blocked.filter((p) => !(typeof p.sales === 'number' && p.sales > 0)),
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
